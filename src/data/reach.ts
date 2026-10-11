// What each of the reader's notes got from other people: reactions (by emoji), reposts and replies (quotes count too). Read from the relays by the ids of the notes,
// counted per person (a person who reacted twice with the same emoji, or reposted twice, counts once), never counting the reader or anybody muted.
import type { Event } from 'nostr-tools'
import { threadRefs } from '../core/thread.js'
import type { Context } from '../core/verdict.js'
import type { Fetcher } from '../net/fetcher.js'
import { reactionTarget, showReaction } from './activity.js'

const HEX64 = /^[0-9a-f]{64}$/

/** `who`: the people behind the numbers (reactions by emoji, reposts), in the same order. */
export interface Reach { reactions: ReadonlyMap<string, number>; reposts: number; replies: number; who?: { reactions: [string, string[]][]; reposts: string[] } }
export const NO_REACH: Reach = { reactions: new Map(), reposts: 0, replies: 0 }
export const hasReach = (r: Reach | undefined): r is Reach => !!r && (r.reposts > 0 || r.replies > 0 || r.reactions.size > 0)
/** How many reactions in all. */
export const reactionTotal = (r: Reach): number => [...r.reactions.values()].reduce((a, b) => a + b, 0)

/** Pure: the counts for `ids` from the events the relays returned. Anything that is not about one of the ids, or comes from the reader or a muted account, is ignored. */
export function reachOf(events: Event[], ids: readonly string[], ctx: Pick<Context, 'me' | 'muted'>): Map<string, Reach> {
  const wanted = new Set(ids)
  const reacted = new Map<string, Map<string, Set<string>>>(), reposted = new Map<string, Set<string>>(), replied = new Map<string, Set<string>>() // note -> emoji -> people, note -> people, note -> events
  const add = <K, V>(m: Map<K, Set<V>>, k: K, v: V) => { const s = m.get(k) ?? new Set<V>(); s.add(v); m.set(k, s) }
  for (const e of events) {
    if (e.pubkey === ctx.me || ctx.muted.has(e.pubkey)) continue
    if (e.kind === 7) {
      const id = reactionTarget(e)
      if (!id || !wanted.has(id)) continue
      const emoji = showReaction(e.content.replace(/️/g, '')), byEmoji = reacted.get(id) ?? new Map<string, Set<string>>()
      add(byEmoji, emoji, e.pubkey); reacted.set(id, byEmoji)
    } else if (e.kind === 6 || e.kind === 16) {
      const id = reactionTarget(e)
      if (id && wanted.has(id)) add(reposted, id, e.pubkey)
    } else if (e.kind === 1) {
      const reply = threadRefs(e).reply
      if (reply && wanted.has(reply)) add(replied, reply, e.id)
      for (const t of e.tags) if (t[0] === 'q' && HEX64.test(t[1] ?? '') && wanted.has(t[1]!)) add(replied, t[1]!, e.id) // a quote counts like a reply
    }
  }
  const out = new Map<string, Reach>()
  for (const id of wanted) {
    const byEmoji = [...(reacted.get(id) ?? new Map<string, Set<string>>())].map(([emoji, people]) => [emoji, [...people]] as [string, string[]]).sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
    const reactions = new Map(byEmoji.map(([emoji, people]) => [emoji, people.length] as const))
    const r: Reach = { reactions, reposts: reposted.get(id)?.size ?? 0, replies: replied.get(id)?.size ?? 0, who: { reactions: byEmoji, reposts: [...(reposted.get(id) ?? [])] } }
    if (hasReach(r)) out.set(id, r)
  }
  return out
}

const CHUNK = 50 // relays refuse long lists of tag values

export async function loadReach(f: Fetcher, ids: readonly string[], ctx: Pick<Context, 'me' | 'muted'>): Promise<Map<string, Reach>> {
  const unique = [...new Set(ids)].filter((i) => HEX64.test(i))
  const chunks: string[][] = []
  for (let i = 0; i < unique.length; i += CHUNK) chunks.push(unique.slice(i, i + CHUNK))
  const answers = await Promise.all(chunks.flatMap((c) => [
    f.query({ kinds: [7], '#e': c, limit: 500 }), f.query({ kinds: [6, 16], '#e': c, limit: 300 }), f.query({ kinds: [1], '#e': c, limit: 300 }), f.query({ kinds: [1], '#q': c, limit: 100 }),
  ].map((p) => p.catch(() => [] as Event[]))))
  const seen = new Set<string>()
  return reachOf(answers.flat().filter((e) => !seen.has(e.id) && seen.add(e.id)), unique, ctx)
}
