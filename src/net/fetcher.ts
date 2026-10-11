// The only place that talks to relays. Everything above it takes a `Fetcher`, so it can be tested with a fake one.
// A relay is a stranger: what it returns is dropped unless the signature is valid and the event really answers the question asked.
import { verifyEvent, type Event, type Filter } from 'nostr-tools'
import { SimplePool } from 'nostr-tools/pool'
import { AbstractSimplePool } from 'nostr-tools/abstract-pool'
import type { VerifyMany } from './verifier.js'

/** How long to wait. By default notes and the like do not wait for the slowest relay and everything else waits for all of them; `quick` and `grace` (ms) override that. */
/** `also`: a few more relays to ask this once (where a note says it can be found), besides the reader's own. */
export interface QueryOptions { quick?: boolean; grace?: number; also?: string[] }

export interface Fetcher {
  query(filter: Filter, options?: QueryOptions): Promise<Event[]>
}

export const DEFAULT_RELAYS = [
  'wss://relay.hivescope.xyz', 'wss://relay.primal.net', 'wss://relay.damus.io', 'wss://nos.lol', 'wss://nostr.oxtr.dev', 'wss://nostr.mom',
]

/** Does the event answer the filter? (A relay can send anything; we do not trust it to have applied the filter.) */
export function answers(filter: Filter, e: Event): boolean {
  if (filter.ids && !filter.ids.includes(e.id)) return false
  if (filter.kinds && !filter.kinds.includes(e.kind)) return false
  if (filter.authors && !filter.authors.includes(e.pubkey)) return false
  for (const [key, wanted] of Object.entries(filter)) {
    if (!key.startsWith('#') || !Array.isArray(wanted)) continue
    const name = key.slice(1)
    if (!e.tags.some((t) => t[0] === name && (wanted as string[]).includes(t[1] ?? ''))) return false
  }
  return true
}

/** Keeps each event once, verified and relevant. Pure, so it is tested without a network. */
export function accept(filter: Filter, events: Event[], verify: (e: Event) => boolean = verifyEvent): Event[] {
  const seen = new Set<string>()
  const out: Event[] = []
  for (const e of events) {
    if (seen.has(e.id) || !answers(filter, e)) continue
    seen.add(e.id)
    if (verify(e)) out.push(e)
  }
  return out
}

/** Notes, reposts, reactions, profiles and single notes by id: a relay that is slow to answer holds little that the others do not, so they do not wait for the last one. */
export const isQuick = (filter: Filter): boolean => !!filter.ids || (filter.kinds ?? [-1]).every((k) => [0, 1, 6, 7, 16].includes(k))

/** One subscription to one relay: `onevent` for each event, `oneose` when it has said all it has (or failed: then there is nothing more to wait for there). */
export type Subscribe = (url: string, filter: Filter, on: { onevent(e: Event): void; oneose(): void; /** Asked BEFORE the signature is checked: an event another relay already sent is not checked again. */ alreadyHaveEvent(id: string): boolean }) => { close(): void }

/**
 * Asks every relay at the same time and answers when a majority has finished (plus a short moment for the ones about to), or when everybody has, or after `maxWait`.
 * What a slower relay sends later is dropped. Each event is kept once, even if several relays send it.
 */
export function collectQuick(subscribe: Subscribe, relays: string[], filter: Filter, { maxWait = 6000, grace = 200, share = 0.6 } = {}): Promise<Event[]> {
  return new Promise((resolve) => {
    const events: Event[] = [], seen = new Set<string>(), closers: { close(): void }[] = []
    const need = Math.max(1, Math.ceil(relays.length * share))
    let done = 0, finished = false, graceTimer: ReturnType<typeof setTimeout> | undefined
    const finish = () => { if (finished) return; finished = true; clearTimeout(graceTimer); clearTimeout(limit); for (const c of closers) try { c.close() } catch { /* already closed */ } resolve(events) }
    const limit = setTimeout(finish, maxWait)
    if (!relays.length) return finish()
    for (const url of relays) {
      let counted = false
      const oneose = () => { if (counted) return; counted = true; done++; if (done >= relays.length) finish(); else if (done >= need && graceTimer === undefined) graceTimer = setTimeout(finish, grace) }
      closers.push(subscribe(url, filter, { onevent: (e) => { if (!finished && !seen.has(e.id)) { seen.add(e.id); events.push(e) } }, oneose, alreadyHaveEvent: (id) => seen.has(id) }))
    }
  })
}

/** `relays` may be a function, so the list can change while the page is open (the reader edits it in Settings). */
/** Like `accept`, but the signatures are checked all together by `verifyMany` (workers in the browser). */
export async function acceptMany(filter: Filter, events: Event[], verifyMany: VerifyMany): Promise<Event[]> {
  const seen = new Set<string>()
  const candidates = events.filter((e) => !seen.has(e.id) && seen.add(e.id) && answers(filter, e))
  const ok = await verifyMany(candidates)
  return candidates.filter((_, i) => ok[i])
}

/**
 * Relays that keep failing are left alone for a while: after 2 failures in a row a relay is skipped for 2 minutes, then 4, 8… up to 15. One answer puts it
 * back to normal. If every relay is resting, they are all asked anyway (a list with nobody in it would show nothing at all).
 */
export class RelayHealth {
  private readonly state = new Map<string, { fails: number; until: number }>()
  constructor(private readonly now: () => number = Date.now) {}
  ok(url: string): void { this.state.delete(url) }
  fail(url: string): void {
    const s = this.state.get(url) ?? { fails: 0, until: 0 }
    s.fails++
    if (s.fails >= 2) s.until = this.now() + Math.min(15, 2 ** (s.fails - 1)) * 60_000
    this.state.set(url, s)
  }
  resting(url: string): boolean { return (this.state.get(url)?.until ?? 0) > this.now() }
  usable(list: string[]): string[] { const up = list.filter((u) => !this.resting(u)); return up.length ? up : list }
}

/** With `verifyMany`, the relay layer does not check signatures as they arrive (that froze the page): they are checked in one go, off the page, before anything is returned. */
export function poolFetcher(relays: string[] | (() => string[]) = DEFAULT_RELAYS, maxWait = 6000, verifyMany?: VerifyMany, health = new RelayHealth()): Fetcher {
  const pool: SimplePool = verifyMany ? (new AbstractSimplePool({ verifyEvent: () => true, maxWaitForConnection: 3000 }) as unknown as SimplePool) : new SimplePool()
  const check = (filter: Filter, events: Event[]) => (verifyMany ? acceptMany(filter, events, verifyMany) : Promise.resolve(accept(filter, events)))
  const subscribe: Subscribe = (url, filter, on) => {
    let answered = false
    const sub = pool.subscribeMany([url], filter, {
      maxWait, onevent: on.onevent, alreadyHaveEvent: on.alreadyHaveEvent,
      oneose: () => { answered = true; on.oneose() }, // (the pool also calls this when a relay cannot be reached: the close reason tells them apart)
      onclose: (reasons: { reason: string }[] | string) => {
        const why = typeof reasons === 'string' ? reasons : reasons?.[0]?.reason ?? ''
        if (/closed by caller|closed automatically/i.test(why)) { if (answered) health.ok(url) } else health.fail(url) // closed by us after an answer: fine; any other reason: it failed
        on.oneose()
      },
    } as Parameters<SimplePool['subscribeMany']>[2])
    return { close: () => sub.close() }
  }
  return {
    query: async (filter, options) => {
      const list = health.usable([...new Set([...(typeof relays === 'function' ? relays() : relays), ...(options?.also ?? []).slice(0, 4)])])
      return check(filter, options?.quick ?? isQuick(filter) ? await collectQuick(subscribe, list, filter, { maxWait, ...(options?.grace !== undefined ? { grace: options.grace } : {}) }) : await pool.querySync(list, filter, { maxWait }))
    },
  }
}

/** The same query for many authors, a hundred at a time (relays refuse long lists), merged without duplicates. */
export async function queryAuthors(f: Fetcher, base: Filter, authors: string[], size = 100): Promise<Event[]> {
  const chunks: string[][] = []
  for (let i = 0; i < authors.length; i += size) chunks.push(authors.slice(i, i + size))
  const parts = await Promise.all(chunks.map((c) => f.query({ ...base, authors: c })))
  const seen = new Set<string>()
  return parts.flat().filter((e) => !seen.has(e.id) && seen.add(e.id))
}

/** Remembers answers for the life of the page, so changing a filter setting re-judges without asking the relays again. `clear()` is "refresh". */
export function memo(f: Fetcher): Fetcher & { clear(): void } {
  const cache = new Map<string, Promise<Event[]>>()
  return {
    query: (filter, options) => {
      const key = JSON.stringify([filter, options?.quick === false ? 'all' : '', options?.also ?? []]) // waiting for every relay, or asking more, is another question
      let hit = cache.get(key)
      if (!hit) { hit = f.query(filter, options); hit.catch(() => cache.delete(key)); cache.set(key, hit) }
      return hit
    },
    clear: () => cache.clear(),
  }
}
