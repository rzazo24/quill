// The "Highlights" view: notes with substance that the people you follow talked about. Not a count of likes: a note gets in when it says something
// (enough words of its own, not counting links, mentions or tags) and your follows answered, quoted or shared it; a reaction alone counts little.
// Two days: the notes of the people you follow, and notes by anyone that your follows replied to, quoted or reposted. At most two per author, never yours.
// Each note says who of your follows picked it. A rule, not an editor: it cannot read, it only weighs signals.
import type { Event } from 'nostr-tools'
import { isReply, threadRefs } from '../core/thread.js'
import { readZap, ZAP_RECEIPT_KIND } from '../core/zap.js'
import { judgeAll, type Context, type Judged, type Settings, DEFAULT_SETTINGS } from '../core/verdict.js'
import { queryAuthors, type Fetcher } from '../net/fetcher.js'
import { verifyEvent } from 'nostr-tools'

export const HIGHLIGHTS_WINDOW_SEC = 48 * 3600
export const HIGHLIGHTS_LIMIT = 30
export const MIN_WORDS = 40
const FOLLOWED_BONUS = 3 // someone you chose to follow starts ahead of a stranger
const PER_AUTHOR = 2
const HEX = /^[0-9a-f]{64}$/

/** Words a note says itself: links, nostr: references, #tags and @-style handles do not count. */
export const ownWords = (content: string): number => content.replace(/https?:\/\/\S+/g, ' ').replace(/nostr:\S+/g, ' ').replace(/[#@]\S+/g, ' ').split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w)).length

export interface Signal { talked: Set<string>; shared: Set<string>; liked: Set<string> }

/** Who of your follows answered or quoted (talked), reposted (shared) or reacted to (liked) which note. Pure. */
export function signalsOf(events: Event[], follows: ReadonlySet<string>, me: string, since = 0): Map<string, Signal> {
  const out = new Map<string, Signal>()
  const get = (id: string) => { let s = out.get(id); if (!s) out.set(id, (s = { talked: new Set(), shared: new Set(), liked: new Set() })); return s }
  for (const e of events) {
    if (!follows.has(e.pubkey) || e.pubkey === me || e.created_at < since) continue
    if (e.kind === 7) { if (e.content.trim() === '-') continue; const id = [...e.tags].reverse().find((t) => t[0] === 'e')?.[1]; if (id && HEX.test(id)) get(id).liked.add(e.pubkey) }
    else if (e.kind === 6 || e.kind === 16) { const id = [...e.tags].reverse().find((t) => t[0] === 'e')?.[1]; if (id && HEX.test(id)) get(id).shared.add(e.pubkey) }
    else if (e.kind === 1) {
      const r = threadRefs(e).reply; if (r && HEX.test(r)) get(r).talked.add(e.pubkey)
      for (const t of e.tags) if (t[0] === 'q' && HEX.test(t[1] ?? '')) get(t[1]!).talked.add(e.pubkey)
    }
  }
  return out
}

/** The score of a note: conversation and sharing by your follows weigh most, a like little; a few points for sats received and for length. */
export function scoreOf(s: Signal | undefined, words: number, sats: number, followed = false): number {
  return (followed ? FOLLOWED_BONUS : 0) + 3 * (s?.talked.size ?? 0) + 3 * (s?.shared.size ?? 0) + (s?.liked.size ?? 0) + Math.min(3, Math.log10(1 + sats)) + Math.min(2, words / 100)
}

/** A stranger's note is brought in only when your follows talked about it (a reply or a quote) or at least two of them shared it: one repost alone is not enough. */
export const broughtIn = (s: Signal | undefined): boolean => !!s && (s.talked.size > 0 || s.shared.size >= 2)

/** Ranks the candidates (already judged and shown), at most PER_AUTHOR per author. Pure. */
export function pickHighlights(notes: Event[], signals: Map<string, Signal>, zaps: Map<string, number>, follows: ReadonlySet<string>, me: string, limit = HIGHLIGHTS_LIMIT): Event[] {
  const ok = notes.filter((e) => e.kind === 1 && e.pubkey !== me && !isReply(e) && ownWords(e.content) >= MIN_WORDS && (follows.has(e.pubkey) || broughtIn(signals.get(e.id))))
  const ranked = ok.map((e) => ({ e, score: scoreOf(signals.get(e.id), ownWords(e.content), zaps.get(e.id) ?? 0, follows.has(e.pubkey)) })).sort((a, b) => b.score - a.score || b.e.created_at - a.e.created_at || (a.e.id < b.e.id ? -1 : 1))
  const perAuthor = new Map<string, number>(), out: Event[] = []
  for (const { e } of ranked) { const n = perAuthor.get(e.pubkey) ?? 0; if (n >= PER_AUTHOR) continue; perAuthor.set(e.pubkey, n + 1); out.push(e); if (out.length >= limit) break }
  return out
}

export async function loadHighlights(f: Fetcher, ctx: Context, nowSec: number, settings: Settings = DEFAULT_SETTINGS, verify: (e: Event) => boolean = verifyEvent): Promise<Judged[]> {
  const follows = [...ctx.follows]
  if (!follows.length) return []
  const since = nowSec - HIGHLIGHTS_WINDOW_SEC
  const theirs = (await queryAuthors(f, { kinds: [1, 6, 7, 16], since, limit: 2000 }, follows)).filter((e) => e.created_at >= since)
  const signals = signalsOf(theirs, ctx.follows, ctx.me, since)
  const own = theirs.filter((e) => e.kind === 1 && !isReply(e))
  const outsideIds = [...signals].filter(([id, s]) => broughtIn(s) && !own.some((e) => e.id === id)).map(([id]) => id).slice(0, 300)
  const outside: Event[] = []
  for (let i = 0; i < outsideIds.length; i += 100) outside.push(...(await f.query({ ids: outsideIds.slice(i, i + 100), kinds: [1] })).filter((e) => outsideIds.includes(e.id)))
  const seen = new Set<string>()
  const pool = [...own, ...outside].filter((e) => !seen.has(e.id) && seen.add(e.id) && ownWords(e.content) >= MIN_WORDS && !isReply(e) && e.pubkey !== ctx.me)
  // the filter's own verdict first (a hidden note is not a highlight); outside your network is fine here: your follows brought it
  const here: Settings = { ...settings, rules: { ...settings.rules, outsideNetwork: false } }
  const shown = new Set(judgeAll(pool, ctx, here).filter((j) => !j.verdict.hidden).map((j) => j.event.id))
  const candidates = pool.filter((e) => shown.has(e.id))
  // sats received, for the few best candidates only (one question)
  const zaps = new Map<string, number>(), top = pickHighlights(candidates, signals, zaps, ctx.follows, ctx.me, HIGHLIGHTS_LIMIT * 2).map((e) => e.id)
  if (top.length) for (const r of await f.query({ kinds: [ZAP_RECEIPT_KIND], '#e': top.slice(0, 50), limit: 500 }).catch(() => [] as Event[])) { const z = readZap(r, verify); if (z && top.includes(z.target)) zaps.set(z.target, (zaps.get(z.target) ?? 0) + z.sats) }
  const picked = pickHighlights(candidates, signals, zaps, ctx.follows, ctx.me)
  // why it is here: who of your follows talked about it (replied or quoted) or, if nobody did, who shared or liked it
  return judgeAll(picked, ctx, here).map((j) => { const s = signals.get(j.event.id); const talked = [...(s?.talked ?? [])], other = [...new Set([...(s?.shared ?? []), ...(s?.liked ?? [])])]; return talked.length ? { ...j, talkedBy: talked } : other.length ? { ...j, pickedBy: other } : j })
}
