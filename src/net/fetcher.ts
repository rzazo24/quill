// The only place that talks to relays. Everything above it takes a `Fetcher`, so it can be tested with a fake one.
// A relay is a stranger: what it returns is dropped unless the signature is valid and the event really answers the question asked.
import { verifyEvent, type Event, type Filter } from 'nostr-tools'
import { SimplePool } from 'nostr-tools/pool'
import { AbstractSimplePool } from 'nostr-tools/abstract-pool'
import type { VerifyMany } from './verifier.js'

/** How long to wait. By default notes and the like do not wait for the slowest relay and everything else waits for all of them; `quick` and `grace` (ms) override that. */
/** `also`: a few more relays to ask this once (where a note says it can be found), besides the reader's own. */
/** `only`: ask exactly these relays instead of the reader's (a followed person's own relays, see data/outbox.ts). */
export interface QueryOptions { quick?: boolean; grace?: number; also?: string[]; only?: string[] }

export interface Fetcher {
  query(filter: Filter, options?: QueryOptions): Promise<Event[]>
  /** Drops every open connection, so the next question opens fresh ones. A phone that put the app in the background may have cut them without
   *  telling it: a question sent down such a connection only times out, and "nothing came" would read as "nothing new". */
  reconnect?(): void
  /** When (ms) a question was last sent to the relays, and when any relay last answered one. An empty view asked after `asked` with no answer since
   *  did not hear from anybody: "nothing here" would be a lie, it is "no connection". */
  activity?(): { asked: number; answered: number; /** when (ms) an answer last came back partial (cut short, or most relays failed) */ partial?: number }
}

export const DEFAULT_RELAYS = [
  'wss://relay.hivescope.xyz', 'wss://relay.primal.net', 'wss://nostr.bitcoiner.social', 'wss://nos.lol', 'wss://nostr.oxtr.dev', 'wss://nostr.mom',
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

/** One subscription to one relay: `onevent` for each event, `oneose` when it has said all it has, or `oneose(true)` when it failed (could not connect,
 *  closed on us): then there is nothing more to wait for there, but it did not answer either. */
export type Subscribe = (url: string, filter: Filter, on: { onevent(e: Event): void; oneose(failed?: boolean): void; /** Asked BEFORE the signature is checked: an event another relay already sent is not checked again. */ alreadyHaveEvent(id: string): boolean }) => { close(): void }

/** Answers that may be missing part of what the relays hold: the wait ran out, or most relays failed (poor coverage). They are not to be kept for long. */
const partials = new WeakSet<Event[]>()
export const isPartial = (events: Event[]): boolean => partials.has(events)
export const markPartial = (events: Event[]): Event[] => { partials.add(events); return events }

/**
 * Asks every relay at the same time and answers when a majority of those that can be reached has answered (plus a short moment for the ones about to),
 * or when everybody has finished, or after `maxWait`. Only an answer counts towards the majority: a relay that fails (no coverage, refused connection)
 * only lowers how many are waited for. Otherwise, with poor coverage, a few quick failures made a "majority" before any real answer had arrived.
 * What a slower relay sends later is dropped. Each event is kept once, even if several relays send it. An answer cut short, or given by fewer than half
 * of the relays, is marked partial (`isPartial`).
 */
export function collectQuick(subscribe: Subscribe, relays: string[], filter: Filter, { maxWait = 6000, grace = 200, share = 0.6 } = {}): Promise<Event[]> {
  return new Promise((resolve) => {
    const events: Event[] = [], seen = new Set<string>(), closers: { close(): void }[] = []
    let answered = 0, failed = 0, finished = false, graceTimer: ReturnType<typeof setTimeout> | undefined
    const finish = (timedOut = false) => {
      if (finished) return; finished = true; clearTimeout(graceTimer); clearTimeout(limit)
      for (const c of closers) try { c.close() } catch { /* already closed */ }
      resolve(timedOut || answered * 2 < relays.length ? markPartial(events) : events)
    }
    const limit = setTimeout(() => finish(answered < Math.max(1, Math.ceil((relays.length - failed) * share))), maxWait)
    if (!relays.length) return finish()
    for (const url of relays) {
      let counted = false
      const oneose = (bad?: boolean) => {
        if (counted) return; counted = true
        if (bad) failed++; else answered++
        if (answered + failed >= relays.length) return finish()
        const need = Math.max(1, Math.ceil((relays.length - failed) * share))
        if (answered >= need && graceTimer === undefined) graceTimer = setTimeout(() => finish(), grace)
      }
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
  let asked = 0, answeredAt = 0, partialAt = 0
  const check = (filter: Filter, events: Event[]) => (verifyMany ? acceptMany(filter, events, verifyMany) : Promise.resolve(accept(filter, events)))
  /** One round of questions: the relays that failed in it are only marked as failing if another relay answered. If none did, the reader's connection is
   *  what failed (no coverage), and resting the relays would keep the good ones away for minutes once it is back. */
  type Round = { answered: number; failed: string[] }
  const subscribe = (round: Round): Subscribe => (url, filter, on) => {
    let answered = false, eose = false
    const sub = pool.subscribeMany([url], filter, {
      maxWait, onevent: (e: Event) => { answeredAt = Date.now(); on.onevent(e) }, alreadyHaveEvent: on.alreadyHaveEvent,
      // the pool also calls this, right before onclose, when a relay cannot be reached: wait a moment to know which it was
      oneose: () => { eose = true; queueMicrotask(() => { if (!eose) return; answered = true; round.answered++; on.oneose() }) },
      onclose: (reasons: { reason: string }[] | string) => {
        const why = typeof reasons === 'string' ? reasons : reasons?.[0]?.reason ?? ''
        if (/closed by caller|closed automatically/i.test(why)) { if (answered) { health.ok(url); answeredAt = Date.now() } on.oneose(); return } // closed by us after an answer: fine
        if (!answered) { eose = false; round.failed.push(url) } // any other reason, before an answer: it failed
        on.oneose(!answered)
      },
    } as Parameters<SimplePool['subscribeMany']>[2])
    return { close: () => sub.close() }
  }
  const quickly = async (list: string[], filter: Filter, options?: QueryOptions): Promise<Event[]> => {
    const round: Round = { answered: 0, failed: [] }
    const raw = await collectQuick(subscribe(round), list, filter, { maxWait, ...(options?.grace !== undefined ? { grace: options.grace } : {}) })
    if (round.answered) for (const url of round.failed) health.fail(url)
    const out = await check(filter, raw)
    if (!isPartial(raw)) return out
    partialAt = Date.now()
    return markPartial(out)
  }
  return {
    query: async (filter, options) => {
      const list = options?.only?.length ? options.only.filter((u) => !health.resting(u)) : health.usable([...new Set([...(typeof relays === 'function' ? relays() : relays), ...(options?.also ?? []).slice(0, 4)])])
      if (!list.length) return [] // the only relays asked for are resting: nothing to ask
      asked = Date.now()
      return options?.quick ?? isQuick(filter) ? quickly(list, filter, options) : check(filter, await pool.querySync(list, filter, { maxWait }))
    },
    activity: () => ({ asked, answered: answeredAt, partial: partialAt }),
    reconnect: () => { try { pool.close([...pool.listConnectionStatus()].filter(([, open]) => open).map(([url]) => url)) } catch { /* nothing open */ } }, // (one still connecting is fresh anyway)
  }
}

/** The same query for many authors, a hundred at a time (relays refuse long lists), merged without duplicates. */
export async function queryAuthors(f: Fetcher, base: Filter, authors: string[], size = 100, options?: QueryOptions): Promise<Event[]> {
  const chunks: string[][] = []
  for (let i = 0; i < authors.length; i += size) chunks.push(authors.slice(i, i + size))
  const parts = await Promise.all(chunks.map((c) => (options ? f.query({ ...base, authors: c }, options) : f.query({ ...base, authors: c }))))
  const seen = new Set<string>()
  return parts.flat().filter((e) => !seen.has(e.id) && seen.add(e.id))
}

/** Remembers answers for the life of the page, so changing a filter setting re-judges without asking the relays again. `clear()` is "refresh".
 *  An empty answer, or a partial one (`isPartial`: cut short, or most relays failed), is kept only `emptyMs`: with poor coverage the relays may not have
 *  answered in time, and the view should ask again without a refresh. */
export function memo(f: Fetcher, emptyMs = 30_000, now: () => number = Date.now): Fetcher & { clear(): void; reconnect(): void } {
  const cache = new Map<string, { p: Promise<Event[]>; empty?: number }>()
  return {
    query: (filter, options) => {
      const key = JSON.stringify([filter, options?.quick === false ? 'all' : '', options?.also ?? [], options?.only ?? []]) // waiting for every relay, or asking more, is another question
      let hit = cache.get(key)
      if (hit?.empty !== undefined && now() - hit.empty >= emptyMs) hit = undefined
      if (!hit) {
        const entry: { p: Promise<Event[]>; empty?: number } = { p: f.query(filter, options) }
        entry.p.then((r) => { if (!r.length || isPartial(r)) entry.empty = now() }, () => { if (cache.get(key) === entry) cache.delete(key) })
        cache.set(key, (hit = entry))
      }
      return hit.p
    },
    reconnect: () => f.reconnect?.(),
    ...(f.activity ? { activity: () => f.activity!() } : {}),
    clear: () => cache.clear(),
  }
}
