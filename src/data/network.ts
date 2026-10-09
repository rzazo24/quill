// The "Network" view: notes of the people your follows follow. It is built on what the app already knows (the follow lists it fetched for the filter's graph), and every
// note says why it is there: which of your follows follow its author.
import type { Event } from 'nostr-tools'
import { isReply } from '../core/thread.js'
import { judgeAll, type Context, type Judged, type Settings, DEFAULT_SETTINGS } from '../core/verdict.js'
import { queryAuthors, type Fetcher } from '../net/fetcher.js'
import type { Session } from './session.js'

/** Most accounts asked about at once: the ones followed by the most of your follows (the strongest ties). */
export const MAX_NETWORK_AUTHORS = 200
export const NETWORK_LIMIT = 100

export interface Candidate { author: string; /** Your follows that follow this account (the order is a steady mix: it only decides whose name comes first). */ via: string[] }

/** Accounts followed by at least one of your follows and not by you (nor you, nor muted), the ones with the most followers among your follows first. */
export function networkCandidates(s: Pick<Session, 'me' | 'follows' | 'muted' | 'graphInfo'>, max = MAX_NETWORK_AUTHORS): Candidate[] {
  const via = new Map<string, string[]>()
  for (const [owner, list] of s.graphInfo.lists) {
    if (!s.follows.has(owner)) continue
    for (const a of new Set(list)) {
      if (a === s.me || s.follows.has(a) || s.muted.has(a) || !/^[0-9a-f]{64}$/.test(a)) continue
      const v = via.get(a); if (v) v.push(owner); else via.set(a, [owner])
    }
  }
  // which of your follows is named first on a note varies from account to account (a steady mix of the two keys), so the same name is not on every card
  const mix = (owner: string, author: string) => (parseInt(owner.slice(0, 8), 16) ^ parseInt(author.slice(0, 8), 16)) >>> 0
  return [...via].map(([author, v]) => ({ author, via: [...v].sort((p, q) => mix(p, author) - mix(q, author) || (p < q ? -1 : 1)) })).sort((a, b) => b.via.length - a.via.length || (a.author < b.author ? -1 : 1)).slice(0, max)
}

const byNewest = (a: Event, b: Event) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1)

/** Root notes of those accounts, newest first. The "outside your network" rule is off here (this view IS the network); every other rule applies. */
export async function loadNetwork(f: Fetcher, s: Session, ctx: Context, settings: Settings = DEFAULT_SETTINGS): Promise<Judged[]> {
  const candidates = networkCandidates(s)
  if (!candidates.length) return []
  const viaOf = new Map(candidates.map((c) => [c.author, c.via]))
  const events = (await queryAuthors(f, { kinds: [1], limit: NETWORK_LIMIT }, candidates.map((c) => c.author))).filter((e) => viaOf.has(e.pubkey) && !isReply(e))
  const roots = events.sort(byNewest).slice(0, NETWORK_LIMIT)
  const here: Settings = { ...settings, rules: { ...settings.rules, outsideNetwork: false } }
  return judgeAll(roots, ctx, here).map((j) => ({ ...j, followedBy: viaOf.get(j.event.pubkey)! }))
}
