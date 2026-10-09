// A small NIP-46 client built for a web page on a phone. The library's own client listens live only, so an answer that the signer published while the
// browser had suspended the page (switching to Clave on the same iPhone does exactly that) is lost for good. This one follows every request in TWO ways:
// a live subscription (instant) and a periodic question to the relay for everything since a little before the request (it finds what the page slept
// through, and also heals a connection that died quietly). Relays that keep kind 24133, as relay.powr.build does, make that second way work.
import { finalizeEvent, getPublicKey, nip44, verifyEvent, type Event, type Filter } from 'nostr-tools'
import type { SimplePool, SubCloser } from 'nostr-tools/pool'
import { bytesToHex } from 'nostr-tools/utils'
import { cleanText } from '../core/text.js'

export const NIP46_KIND = 24133
/** Signer and page clocks differ: look this far back so a slightly "old" answer is not missed. Answers are matched by id or secret, so this is safe. */
export const CLOCK_SLACK_S = 120

export interface ClientOptions {
  pool: SimplePool
  relays: string[]
  secret: Uint8Array
  now?: () => number
  /** How often the relay is asked while something is pending. */
  pollMs?: number
  /** Disable the live subscription (tests: proves the polling alone is enough). */
  live?: boolean
  onAuthUrl?: (url: string) => void
}

export interface WaitOptions { timeoutMs: number; signal?: AbortSignal }

interface Watcher { since: number; handle(e: Event): boolean; fail(err: Error): void }

const HEX64 = /^[0-9a-f]{64}$/
const asError = (e: unknown): Error => (e instanceof Error ? e : new Error(typeof e === 'string' ? e : JSON.stringify(e)))

export class Nip46Client {
  readonly pubkey: string
  signer?: string
  private convKey?: Uint8Array
  private readonly watchers = new Set<Watcher>()
  private sub?: SubCloser
  private timer?: ReturnType<typeof setInterval>
  private polling = false
  private closed = false
  private readonly seen = new Set<string>()
  private readonly now: () => number
  private readonly pollMs: number
  private readonly live: boolean

  constructor(private readonly o: ClientOptions) {
    this.pubkey = getPublicKey(o.secret)
    this.now = o.now ?? Date.now
    this.pollMs = o.pollMs ?? 3000
    this.live = o.live ?? true
  }

  setSigner(pubkey: string): void {
    if (!HEX64.test(pubkey)) throw new Error('not a public key')
    this.signer = pubkey
    this.convKey = nip44.getConversationKey(this.o.secret, pubkey)
  }

  private nowSec = () => Math.floor(this.now() / 1000)

  // ---- following the relays: live + polling, shared by everything that waits ----
  private filter(): Filter {
    const since = Math.min(...[...this.watchers].map((w) => w.since))
    return { kinds: [NIP46_KIND], '#p': [this.pubkey], since, ...(this.signer ? { authors: [this.signer] } : {}) }
  }

  private feed(e: Event): void {
    if (this.seen.has(e.id)) return
    this.seen.add(e.id)
    if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value as string)
    if (!verifyEvent(e) || e.kind !== NIP46_KIND) return
    for (const w of [...this.watchers]) if (w.handle(e)) this.watchers.delete(w)
    this.settleIfIdle()
  }

  private async poll(): Promise<void> {
    if (this.polling || !this.watchers.size || this.closed) return
    this.polling = true
    try {
      const events = await this.o.pool.querySync(this.o.relays, this.filter(), { maxWait: 5000 })
      for (const e of events) this.feed(e)
    } catch { /* the next round tries again */ } finally { this.polling = false }
  }

  /** The page came back to the foreground (or the network did): ask right now instead of waiting for the next round. */
  wake(): void { void this.poll() }

  private run(): void {
    if (this.closed) return
    if (!this.timer) this.timer = setInterval(() => void this.poll(), this.pollMs)
    if (this.live && !this.sub) {
      try { this.sub = this.o.pool.subscribe(this.o.relays, this.filter(), { onevent: (e) => this.feed(e) }) } catch { /* polling still works */ }
    }
  }

  private settleIfIdle(): void {
    if (this.watchers.size) return
    if (this.timer) { clearInterval(this.timer); this.timer = undefined }
    try { this.sub?.close() } catch { /* already closed */ }
    this.sub = undefined
  }

  private watch<T>(since: number, handle: (e: Event, resolve: (v: T) => void, reject: (e: Error) => void) => boolean, opts: WaitOptions, what: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const w: Watcher = { since, handle: (e) => handle(e, finish, fail), fail: (err) => fail(err) }
      const cleanup = () => { if (timer) clearTimeout(timer); this.watchers.delete(w); opts.signal?.removeEventListener('abort', onAbort); this.settleIfIdle() }
      const finish = (v: T) => { cleanup(); resolve(v) }
      const fail = (err: Error) => { cleanup(); reject(err) }
      const onAbort = () => fail(new Error('cancelled'))
      if (opts.signal?.aborted) return reject(new Error('cancelled'))
      opts.signal?.addEventListener('abort', onAbort, { once: true })
      timer = setTimeout(() => fail(new Error(`${what} did not answer within ${Math.round(opts.timeoutMs / 1000)} s`)), opts.timeoutMs)
      this.watchers.add(w)
      this.run()
      void this.poll() // the answer may already be on the relay (a page that was reloaded, or a very fast signer)
    })
  }

  // ---- pairing: waits for the signer's answer to a nostrconnect:// link; its key is learned from the answer ----
  /** Resolves with the signer's public key once an answer that carries `secret` arrives. `sinceSec` is when the link was made. */
  waitForPairing(secret: string, sinceSec: number, opts: WaitOptions): Promise<string> {
    return this.watch<string>(sinceSec - CLOCK_SLACK_S, (e, resolve) => {
      try {
        const reply = JSON.parse(nip44.decrypt(e.content, nip44.getConversationKey(this.o.secret, e.pubkey))) as { result?: unknown }
        if (reply.result !== secret) return false // someone else's message, or an "ack": only the secret proves it answers OUR link
        resolve(e.pubkey)
        return true
      } catch { return false }
    }, opts, 'the signer')
  }

  // ---- requests ----
  /** Sends a request to the signer and resolves with its `result`. Rejects with the signer's error, a cancel, or a timeout. */
  async request(method: string, params: string[], opts: WaitOptions): Promise<string> {
    if (!this.signer || !this.convKey) throw new Error('no signer is set')
    const id = bytesToHex(crypto.getRandomValues(new Uint8Array(8)))
    const created = this.nowSec()
    const event = finalizeEvent({ kind: NIP46_KIND, created_at: created, tags: [['p', this.signer]], content: nip44.encrypt(JSON.stringify({ id, method, params }), this.convKey) }, this.o.secret)
    const answer = this.watch<string>(created - CLOCK_SLACK_S, (e, resolve, reject) => {
      if (e.pubkey !== this.signer) return false
      let reply: { id?: string; result?: string; error?: string }
      try { reply = JSON.parse(nip44.decrypt(e.content, this.convKey!)) } catch { return false }
      if (reply.id !== id) return false
      if (reply.result === 'auth_url' && reply.error) { this.o.onAuthUrl?.(cleanText(reply.error, 300)); return false } // keep waiting: the user approves on that page
      if (reply.error) reject(new Error(cleanText(reply.error, 200) || 'the signer refused'))
      else resolve(String(reply.result ?? ''))
      return true
    }, opts, 'the signer')
    answer.catch(() => {}) // the caller handles it; a cancel after the event is out must not become an unhandled rejection
    await this.send(event)
    return answer
  }

  private async send(event: Event): Promise<void> {
    const sent = this.o.pool.publish(this.o.relays, event)
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('could not reach the signer\'s relays')), 8000))
    try { await Promise.race([Promise.any(sent), timeout]) } catch (e) { throw asError(e) instanceof AggregateError ? new Error('no relay accepted the request') : asError(e) }
  }

  close(): void {
    this.closed = true
    for (const w of [...this.watchers]) w.fail(new Error('closed'))
    this.watchers.clear()
    this.settleIfIdle()
  }
}
