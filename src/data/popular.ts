// The "Popular" view: notes by anyone that the people you follow reacted to or reposted in the last day, the ones the most of them picked first.
// Every note says why it is there: which of your follows picked it. It reaches past your network, so the "outside your network" rule is off here;
// every other rule (and your mutes) still applies.
import type { Event } from 'nostr-tools'
import { isReply } from '../core/thread.js'
import { judgeAll, type Context, type Judged, type Settings, DEFAULT_SETTINGS } from '../core/verdict.js'
import { queryAuthors, type Fetcher } from '../net/fetcher.js'

export const POPULAR_WINDOW_SEC = 24 * 3600
export const POPULAR_LIMIT = 60
const HEX = /^[0-9a-f]{64}$/

/** The note an event points to: the last `e` tag (NIP-25 for reactions; reposts carry one). A "-" reaction is a dislike and picks nothing. */
function target(e: Event): string | null {
  if (e.kind === 7 && e.content.trim() === '-') return null
  const id = [...e.tags].reverse().find((t) => t[0] === 'e')?.[1]
  return id && HEX.test(id) ? id : null
}

/** Which of your follows picked which note, the notes picked by the most first (then the most recently picked). */
export function popularPicks(events: Event[], follows: ReadonlySet<string>, me: string, since = 0): { id: string; by: string[] }[] {
  const by = new Map<string, { who: string[]; last: number }>()
  for (const e of events) {
    if (!follows.has(e.pubkey) || e.pubkey === me || e.created_at < since) continue // a relay may ignore `since`
    const id = target(e); if (!id) continue
    const p = by.get(id) ?? { who: [], last: 0 }
    if (!p.who.includes(e.pubkey)) p.who.push(e.pubkey)
    p.last = Math.max(p.last, e.created_at); by.set(id, p)
  }
  return [...by].sort((a, b) => b[1].who.length - a[1].who.length || b[1].last - a[1].last || (a[0] < b[0] ? -1 : 1)).map(([id, p]) => ({ id, by: p.who }))
}

export async function loadPopular(f: Fetcher, ctx: Context, nowSec: number, settings: Settings = DEFAULT_SETTINGS): Promise<Judged[]> {
  const follows = [...ctx.follows]
  if (!follows.length) return []
  const since = nowSec - POPULAR_WINDOW_SEC
  const picks = await queryAuthors(f, { kinds: [7, 6, 16], since, limit: 1000 }, follows)
  const ranked = popularPicks(picks, ctx.follows, ctx.me, since).slice(0, POPULAR_LIMIT * 2) // some will be replies, gone, or by you
  if (!ranked.length) return []
  const byOf = new Map(ranked.map((r) => [r.id, r.by]))
  const ids = ranked.map((r) => r.id), notes: Event[] = []
  for (let i = 0; i < ids.length; i += 100) notes.push(...await f.query({ ids: ids.slice(i, i + 100), kinds: [1] }))
  const seen = new Set<string>()
  const roots = notes.filter((e) => byOf.has(e.id) && !seen.has(e.id) && seen.add(e.id) && e.pubkey !== ctx.me && !isReply(e))
    .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)).slice(0, POPULAR_LIMIT)
  const here: Settings = { ...settings, rules: { ...settings.rules, outsideNetwork: false } }
  return judgeAll(roots, ctx, here).map((j) => ({ ...j, pickedBy: byOf.get(j.event.id)! }))
}
