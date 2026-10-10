// The NIP-46 session with the user's remote signer (Clave, nsec.app, a bunker). Quill never sees the user's private key: it holds only an
// app key that identifies it to the signer, saved in this browser, and asks the signer to sign. Everything that comes back is checked.
import { generateSecretKey, getPublicKey, verifyEvent, type Event as NostrEvent, type VerifiedEvent } from 'nostr-tools'
import { BunkerSigner, createNostrConnectURI, type BunkerPointer } from 'nostr-tools/nip46'
import { SimplePool } from 'nostr-tools/pool'
import { bytesToHex, hexToBytes } from 'nostr-tools/utils'
import { cleanText } from '../core/text.js'
import { safeGet, safeSet, type KV } from '../ui/store.js'
import { ALLOWED_KINDS, checkTemplate, sameTags, type Template } from './policy.js'

/** Clave only listens on relay.powr.build; the second relay costs nothing and helps other signers. */
export const SIGNER_RELAYS = ['wss://relay.powr.build', 'wss://relay.hivescope.xyz']
export const CLAVE_LINK = 'https://clave.casa/connect/?uri='

export type State = 'disconnected' | 'connecting' | 'connected'
interface Saved { clientSecret: string; signerPubkey?: string; relays?: string[]; /** The key the signer signs as, learned when connecting: lets a reload resume without asking the signer anything. */ userPubkey?: string }

const HEX64 = /^[0-9a-f]{64}$/
/** Time to scan the link, approve in Clave and come back: scanning from a computer with a phone takes a while. */
const CONNECT_WINDOW_MS = 300_000
const IDENTITY_WAIT_MS = 75_000
const RESUME_WAIT_MS = 150_000
const RESUME_ATTEMPT_MS = 20_000

const asError = (e: unknown): Error => (e instanceof Error ? e : new Error(typeof e === 'string' ? e : JSON.stringify(e)))
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} did not answer within ${Math.round(ms / 1000)} s`)), ms)
    p.then((v) => { clearTimeout(timer); resolve(v) }, (e) => { clearTimeout(timer); reject(asError(e)) })
  })
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
/** Lets pending CLOSE messages leave before the sockets do (see `disconnect`). */
async function closePool(pool: SimplePool | undefined, relays: string[]): Promise<void> {
  if (!pool) return
  await sleep(50)
  try { pool.close(relays) } catch { /* already closed */ }
}

export interface SignerOptions {
  kv?: KV
  relays?: string[]
  timeouts?: Partial<{ connectMs: number; identityMs: number; resumeMs: number; attemptMs: number }>
  now?: () => number
  /** Tests only: also accept ws:// relays on this machine in a bunker:// address (a real page is limited to wss:// by its CSP anyway). */
  allowLoopback?: boolean
  /** The page's own address, shown by the signer next to the name so you can tell which app is asking (https only). */
  appUrl?: string
}

export class Signer {
  state: State = 'disconnected'
  pubkey?: string
  lastError?: string
  /** An approval page the signer asked the user to open, cleaned. */
  authUrl?: string
  private bunker?: BunkerSigner
  /** Cancels a connection that is still waiting for the user to approve it. */
  private pending?: AbortController
  private connecting?: Promise<boolean>
  private pool?: SimplePool
  private listeners: (() => void)[] = []
  private readonly kv?: KV
  private readonly relays: string[]
  private readonly t: Required<NonNullable<SignerOptions['timeouts']>>
  private readonly now: () => number
  private readonly allowLoopback: boolean
  private readonly appUrl?: string

  constructor(opts: SignerOptions = {}) {
    this.allowLoopback = opts.allowLoopback ?? false
    this.appUrl = opts.appUrl?.startsWith('https://') ? opts.appUrl : undefined
    this.kv = opts.kv; this.relays = opts.relays ?? SIGNER_RELAYS; this.now = opts.now ?? Date.now
    this.t = { connectMs: CONNECT_WINDOW_MS, identityMs: IDENTITY_WAIT_MS, resumeMs: RESUME_WAIT_MS, attemptMs: RESUME_ATTEMPT_MS, ...opts.timeouts }
  }

  onChange(cb: () => void): void { this.listeners.push(cb) }
  private set(state: State, error?: string): void { this.state = state; this.lastError = error; for (const l of this.listeners) l() }

  // ---- the saved session: app key + the signer's key and relays. It is NOT the user's key. ----
  private load(): Saved | null {
    try {
      const s = JSON.parse(safeGet(this.kv, 'signer') ?? 'null') as Saved | null
      return s && typeof s.clientSecret === 'string' && HEX64.test(s.clientSecret) ? s : null
    } catch { return null }
  }
  private save(s: Saved): void { safeSet(this.kv, 'signer', JSON.stringify(s)) }
  hasSavedSession(): boolean { const s = this.load(); return !!(s?.signerPubkey && HEX64.test(s.signerPubkey) && s.relays?.length) }
  private appKey(): Uint8Array {
    const saved = this.load()
    if (saved) return hexToBytes(saved.clientSecret)
    const sk = generateSecretKey(); this.save({ clientSecret: bytesToHex(sk) }); return sk
  }
  private params(pool = (this.pool ??= new SimplePool())) { return { pool, skipSwitchRelays: true, onauth: (url: string) => { this.authUrl = cleanText(url, 300) } } }

  private async established(b: BunkerSigner, secretHex: string): Promise<void> {
    this.bunker = b
    const pubkey = await withTimeout(b.getPublicKey(), this.t.identityMs, 'the signer (which key it signs as). Keep the signer app open on screen while connecting')
    if (!HEX64.test(pubkey)) throw new Error('the signer sent something that is not a public key')
    this.pubkey = pubkey
    this.save({ clientSecret: secretHex, signerPubkey: b.bp.pubkey, relays: b.bp.relays, userPubkey: pubkey })
    this.set('connected')
  }

  // ---- connecting ----
  /** A link for the user's signer. The session completes in the background; `done` settles when it does (never rejects). */
  startConnect(): { uri: string; claveLink: string; done: Promise<boolean> } {
    const sk = this.appKey(), secretHex = bytesToHex(sk)
    const secret = bytesToHex(crypto.getRandomValues(new Uint8Array(16)))
    const perms = ['get_public_key', ...ALLOWED_KINDS.map((k) => `sign_event:${k}`)]
    const uri = createNostrConnectURI({ clientPubkey: getPublicKey(sk), relays: this.relays, secret, perms, name: 'Quill', url: this.appUrl })
    this.pending?.abort()
    const ac = this.pending = new AbortController()
    this.set('connecting')
    // The library only notices an abort once its subscription to each relay exists, so cancelling early would otherwise wait for the full timeout:
    // the cancellation is also raced here, which settles `done` at once.
    const cancelled = new Promise<never>((_, reject) => ac.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))
    cancelled.catch(() => {}) // not an unhandled rejection when nobody is racing it any more
    const done = (async () => {
      try {
        const b = await Promise.race([BunkerSigner.fromURI(sk, uri, this.params(), AbortSignal.any([ac.signal, AbortSignal.timeout(this.t.connectMs)])), cancelled])
        await this.established(b, secretHex)
        return true
      } catch (e) {
        await this.drop()
        if (!ac.signal.aborted) this.set('disconnected', cleanText(asError(e).message, 200)) // cancelled by the user: no error to show
        return false
      } finally { if (this.pending === ac) this.pending = undefined }
    })()
    this.connecting = done
    return { uri, claveLink: CLAVE_LINK + encodeURIComponent(uri), done }
  }

  /** Connects with a bunker:// address the user pasted. (Addresses that need a web lookup, like NIP-05, are not accepted.) */
  async connectBunker(input: string): Promise<boolean> {
    const text = input.trim()
    let url: URL
    try { url = new URL(text) } catch { this.set('disconnected', 'not a valid bunker:// address'); return false }
    const pubkey = (url.hostname || url.pathname.replace(/^\/+/, '')).toLowerCase()
    const relays = url.searchParams.getAll('relay').filter((r) => /^wss:\/\/[^\s/]+/.test(r) || (this.allowLoopback && /^ws:\/\/127\.0\.0\.1[:/]/.test(r)))
    if (url.protocol !== 'bunker:' || !HEX64.test(pubkey) || !relays.length) { this.set('disconnected', 'the bunker:// address needs a signer key and at least one wss:// relay'); return false }
    const sk = this.appKey()
    this.set('connecting')
    try {
      const bp: BunkerPointer = { pubkey, relays, secret: url.searchParams.get('secret') }
      const b = BunkerSigner.fromBunker(sk, bp, this.params())
      await withTimeout(b.connect({ name: 'Quill' }), this.t.connectMs, 'the signer (connect)')
      await this.established(b, bytesToHex(sk))
      return true
    } catch (e) { await this.drop(); this.set('disconnected', cleanText(asError(e).message, 200)); return false }
  }

  /**
   * Resumes the saved session. When the key the signer signs as was saved (it is, since connecting), this is instant and sends NOTHING: a phone signer in
   * the background cannot answer, and asking it on every page load would only pile up notifications and block signing. Whether the signer is there is
   * found out by the first signature, which verifies the author anyway (a wrong saved key can never make Quill publish as someone else).
   * Sessions saved by older versions have no such key: those ask the signer, and keep asking for a couple of minutes while the user opens it. The saved
   * session is left alone when it fails.
   */
  async resume(hint?: string): Promise<boolean> {
    if (this.state === 'connected') return true
    const saved = this.load()
    if (!saved?.signerPubkey || !saved.relays?.length) return false
    // `hint` is the account the user is reading as: for a session saved before the signer's key was stored, it stands in for it until the first signature
    // confirms it (a wrong hint is refused there and is never saved).
    const known = saved.userPubkey ?? hint
    if (known && HEX64.test(known) && HEX64.test(saved.signerPubkey)) {
      this.bunker = BunkerSigner.fromBunker(hexToBytes(saved.clientSecret), { pubkey: saved.signerPubkey, relays: saved.relays, secret: null }, this.params())
      this.pubkey = known
      this.set('connected')
      return true
    }
    const end = this.now() + this.t.resumeMs
    this.set('connecting')
    try {
      const b = BunkerSigner.fromBunker(hexToBytes(saved.clientSecret), { pubkey: saved.signerPubkey, relays: saved.relays, secret: null }, this.params())
      this.bunker = b
      for (;;) {
        try { this.pubkey = await withTimeout(b.getPublicKey(), Math.max(1, Math.min(this.t.attemptMs, end - this.now())), 'the signer'); break }
        catch (e) { if (this.now() + 500 >= end) throw new Error('the signer did not answer. Open it (Clave) on screen, or tap its blank notification, and try again; the saved connection is intact') }
      }
      if (!HEX64.test(this.pubkey!)) throw new Error('the signer sent something that is not a public key')
      this.set('connected')
      return true
    } catch (e) { await this.drop(); this.set('disconnected', cleanText(asError(e).message, 200)); return false }
  }

  // ---- using it ----
  /**
   * Asks the signer to sign `t`, and checks what comes back: a valid signature, by the connected key, and exactly the kind, content and tags that
   * were asked for (a compromised or confused signer could return something else). Also refuses anything Quill's own policy does not allow.
   */
  async sign(t: Template, timeoutMs: number, signal?: AbortSignal, opts: { followBase?: NostrEvent } = {}): Promise<{ event: VerifiedEvent; ms: number }> {
    const problem = checkTemplate(t, opts)
    if (problem) throw new Error(`Quill will not sign this (${problem})`)
    if (this.state !== 'connected' || !this.bunker || !this.pubkey) throw new Error('no signer is connected')
    // a follow-list change is built from the reader's OWN list, validly signed: anything else is refused whatever the template says
    if (t.kind === 3 && !(opts.followBase && opts.followBase.pubkey === this.pubkey && verifyEvent(opts.followBase))) throw new Error('Quill will not sign this (follow)')
    const t0 = this.now()
    const asked = this.bunker.signEvent(t)
    // A user who cancels stops waiting; the request itself cannot be recalled, but its answer is ignored and nothing is published.
    const cancelled = signal ? new Promise<never>((_, reject) => { if (signal.aborted) reject(new Error('cancelled')); else signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }) }) : null
    cancelled?.catch(() => {})
    asked.catch(() => {}) // a late answer or error after cancelling is not an unhandled rejection
    const event = await withTimeout(cancelled ? Promise.race([asked, cancelled]) : asked, timeoutMs, 'the signer')
    const ok = verifyEvent(event) && event.pubkey === this.pubkey && event.kind === t.kind && event.content === t.content && sameTags(event.tags, t.tags) && Math.abs(event.created_at - t.created_at) <= 300
    if (!ok) throw new Error('the signer returned an event that differs from what was asked, or is not signed by the connected key. It was discarded and nothing was published')
    const saved = this.load()
    if (saved && !saved.userPubkey) this.save({ ...saved, userPubkey: event.pubkey }) // now confirmed by a real signature: later reloads need no hint
    return { event, ms: this.now() - t0 }
  }

  /** Is the signer awake through the connection held? True only on a real `pong`: silence and local errors both count as "no". */
  async ping(ms: number): Promise<boolean> {
    if (this.state !== 'connected' || !this.bunker) return false
    try { await withTimeout(this.bunker.ping(), ms, 'the signer'); return true } catch { return false }
  }

  /**
   * A long-lived connection can die quietly while the signer app is awake, and then every ping looks like "the app is asleep". This builds a second
   * connection from the saved session on a fresh pool and pings through it; if the signer answers, the old one is replaced (true), otherwise the old
   * one and the saved session are left untouched (false).
   */
  async reconnect(ms: number): Promise<boolean> {
    const saved = this.load()
    if (this.state !== 'connected' || !saved?.signerPubkey || !saved.relays?.length) return false
    const pool = new SimplePool()
    let fresh: BunkerSigner | undefined
    try {
      fresh = BunkerSigner.fromBunker(hexToBytes(saved.clientSecret), { pubkey: saved.signerPubkey, relays: saved.relays, secret: null }, this.params(pool))
      await withTimeout(fresh.ping(), ms, 'the signer')
    } catch {
      try { await fresh?.close() } catch { /* closed */ }
      try { pool.close(saved.relays) } catch { /* closed */ }
      return false
    }
    const oldBunker = this.bunker, oldPool = this.pool
    this.bunker = fresh; this.pool = pool
    try { await oldBunker?.close() } catch { /* it was dead anyway */ }
    await closePool(oldPool, saved.relays)
    return true
  }

  /** Ask before bothering the user: is the signer awake, on this connection or on a fresh one? */
  async awake(ms: number): Promise<boolean> { return (await this.ping(ms)) || (await this.reconnect(ms)) }

  private async drop(): Promise<void> {
    try { await this.bunker?.close() } catch { /* already closed */ }
    this.bunker = undefined; this.pubkey = undefined
  }

  /** Closes the session and forgets the app key. */
  async disconnect(): Promise<void> {
    const wasConnecting = !!this.pending
    if (wasConnecting) { this.pending?.abort(); this.pending = undefined; await sleep(300) } // the library closes its own subscription a moment after the abort
    this.connecting = undefined
    await this.drop()
    // Closing a pool closes its sockets first and sends each subscription's CLOSE after, which the library then logs as an error. After a cancelled
    // connection a subscription may still be opening, so that pool is kept (its idle sockets are harmless and a new attempt reuses them).
    if (!wasConnecting) { await closePool(this.pool, this.relays); this.pool = undefined }
    safeSet(this.kv, 'signer', null)
    this.set('disconnected')
  }
}
