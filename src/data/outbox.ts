// Reading people where they write (NIP-65 "outbox"): someone you follow may publish only on relays that are not yours, and then their notes never reach you.
// Their relay list (kind 10002) says where they write. Quill asks a FEW of those relays too, only for the people who are not on any of yours,
// and each extra relay only for its own people. Each extra relay learns your IP address and whom you read there, so it is a setting (on by default).
import type { Event, Filter } from 'nostr-tools'
import { RELAY_LIST_KIND } from '../sign/policy.js'
import { normalizeRelay } from '../net/relays.js'
import { queryAuthors, type Fetcher } from '../net/fetcher.js'
import { newestPerAuthor } from './lists.js'

export const MAX_EXTRA_RELAYS = 6 // at most this many relays besides the reader's own, per load
export const PER_AUTHOR = 2 // each person is looked for on at most two of their relays (one may be down)

/** The relays a list says its author writes to: `r` tags marked "write" or unmarked. Not valid wss:// addresses are dropped. */
export function writeRelays(e: Event): string[] {
  const out: string[] = []
  for (const t of e.tags) if (t[0] === 'r' && (t[2] === undefined || t[2] === '' || t[2] === 'write')) { const u = normalizeRelay(t[1] ?? ''); if (u && !out.includes(u)) out.push(u) }
  return out
}

/** Where each of these people writes (only those with a list). */
export async function loadWriteRelays(f: Fetcher, pubkeys: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (!pubkeys.length) return out
  const events = await queryAuthors(f, { kinds: [RELAY_LIST_KIND] }, pubkeys, 100, { quick: true, grace: 300 }) // not waiting for the slowest relay: most people's list is everywhere
  for (const [pk, e] of newestPerAuthor(events.filter((e) => e.kind === RELAY_LIST_KIND && pubkeys.includes(e.pubkey)))) out.set(pk, writeRelays(e))
  return out
}

/**
 * Which extra relays to ask, and for whom. Only people with no write relay among the reader's own count. First every one of them gets one relay
 * (each time the relay that covers most of those still uncovered), then, while there is room, a second one (in case the first is down).
 * At most `maxRelays` relays, each person on at most `perAuthor`. Pure.
 */
export function planOutbox(lists: Map<string, string[]>, mine: string[], { maxRelays = MAX_EXTRA_RELAYS, perAuthor = PER_AUTHOR } = {}): Map<string, string[]> {
  const own = new Set(mine.map((u) => normalizeRelay(u) ?? u))
  const missing = new Map<string, string[]>() // person → their relays (none of them the reader's)
  for (const [pk, relays] of lists) if (relays.length && !relays.some((u) => own.has(u))) missing.set(pk, relays)
  const plan = new Map<string, string[]>(), placed = new Map<string, number>()
  for (let round = 1; round <= perAuthor; round++) {
    while (plan.size < maxRelays) {
      const counts = new Map<string, number>()
      for (const [pk, relays] of missing) if ((placed.get(pk) ?? 0) < round) for (const u of relays) if (!plan.has(u)) counts.set(u, (counts.get(u) ?? 0) + 1)
      let best: string | null = null, bestN = 0
      for (const [u, n] of [...counts].sort((x, y) => (x[0] < y[0] ? -1 : 1))) if (n > bestN) { best = u; bestN = n }
      if (!best) break
      // everyone this relay can serve who still has room goes there (not only the ones counted this round)
      const who = [...missing].filter(([pk, relays]) => (placed.get(pk) ?? 0) < perAuthor && relays.includes(best!)).map(([pk]) => pk)
      for (const pk of who) placed.set(pk, (placed.get(pk) ?? 0) + 1)
      plan.set(best, who)
    }
  }
  return plan
}

/** The same question on each extra relay, for its own people only. A relay that fails or is slow simply adds nothing. */
export async function queryOutbox(f: Fetcher, base: Filter, plan: Map<string, string[]>): Promise<Event[]> {
  const parts = await Promise.all([...plan].map(([relay, authors]) => f.query({ ...base, authors }, { only: [relay], quick: true }).catch(() => [] as Event[])))
  const seen = new Set<string>()
  return parts.flat().filter((e) => !seen.has(e.id) && seen.add(e.id))
}

/** Notes (or whatever `base` asks) of these people from where they write, besides the reader's relays: lists, plan and query in one go. */
export async function fromOutbox(f: Fetcher, base: Filter, people: string[], mine: string[]): Promise<Event[]> {
  const plan = planOutbox(await loadWriteRelays(f, people), mine)
  return plan.size ? queryOutbox(f, base, plan) : []
}

export const OUTBOX_PATIENCE = 400 // ms: how much longer than the reader's own relays the page waits for these (what comes later is added afterwards)

/** What `extra` has by `patience` ms after `own` is ready. If it comes later, `onLate` gets it (the page can add it then): it never holds the page up for long. */
export async function withinPatience<T>(own: Promise<T>, extra: Promise<Event[]>, patience = OUTBOX_PATIENCE, onLate?: (events: Event[]) => void): Promise<[T, Event[]]> {
  const safe = extra.catch(() => [] as Event[])
  const mine = await own
  const timeout = Symbol('late')
  const got = await Promise.race([safe, new Promise<typeof timeout>((r) => setTimeout(() => r(timeout), patience))])
  if (got !== timeout) return [mine, got]
  if (onLate) void safe.then((e) => { if (e.length) onLate(e) })
  return [mine, []]
}
