// The only place that talks to relays. Everything above it takes a `Fetcher`, so it can be tested with a fake one.
// A relay is a stranger: what it returns is dropped unless the signature is valid and the event really answers the question asked.
import { verifyEvent, type Event, type Filter } from 'nostr-tools'
import { SimplePool } from 'nostr-tools/pool'

export interface Fetcher {
  query(filter: Filter): Promise<Event[]>
}

export const DEFAULT_RELAYS = [
  'wss://relay.hivescope.xyz', 'wss://relay.primal.net', 'wss://relay.nostr.net', 'wss://nos.lol', 'wss://nostr.oxtr.dev', 'wss://nostr.mom',
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

/** `relays` may be a function, so the list can change while the page is open (the reader edits it in Settings). */
export function poolFetcher(relays: string[] | (() => string[]) = DEFAULT_RELAYS, maxWait = 6000): Fetcher {
  const pool = new SimplePool()
  return { query: async (filter) => accept(filter, await pool.querySync(typeof relays === 'function' ? relays() : relays, filter, { maxWait })) }
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
    query: (filter) => {
      const key = JSON.stringify(filter)
      let hit = cache.get(key)
      if (!hit) { hit = f.query(filter); hit.catch(() => cache.delete(key)); cache.set(key, hit) }
      return hit
    },
    clear: () => cache.clear(),
  }
}
