// What happened around the reader's own notes while they were away: replies and mentions, and reactions to their notes. Everything goes through the
// same filter as the rest of the app, and the new-since-last-visit count only includes what the filter would SHOW (hidden things are counted apart).
import type { Event } from 'nostr-tools'
import { analyse, judge, type Context, type Judged, type Settings, DEFAULT_SETTINGS } from '../core/verdict.js'
import type { Fetcher } from '../net/fetcher.js'
import { normReaction } from './engaged.js'

const HEX64 = /^[0-9a-f]{64}$/
const LIMIT = 100
export const FOLLOWER_LIMIT = 1000
const byNewest = (a: Event, b: Event) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1)

export interface Activity {
  /** Replies and mentions from other people. */
  notes: Judged[]
  /** Reactions from other people to notes that really are the reader's. */
  reactions: Judged[]
  /** The reader's notes that were reacted to, by id (for their text). */
  targets: Map<string, Event>
  /** Accounts whose follow list includes the reader (newest list first), not the reader and not muted. Relays each hold only part of them, so this is what the ones asked returned. */
  followers: string[]
}

/** NIP-25: the note reacted to is the LAST e tag. */
export const reactionTarget = (e: Pick<Event, 'tags'>): string | undefined => [...e.tags].reverse().find((t) => t[0] === 'e' && HEX64.test(t[1] ?? ''))?.[1]

export async function loadActivity(f: Fetcher, ctx: Context, settings: Settings = DEFAULT_SETTINGS): Promise<Activity> {
  const [mentions, reacts, lists] = await Promise.all([f.query({ kinds: [1], '#p': [ctx.me], limit: LIMIT }), f.query({ kinds: [7], '#p': [ctx.me], limit: LIMIT }), f.query({ kinds: [3], '#p': [ctx.me], limit: FOLLOWER_LIMIT }).catch(() => [])])
  const notes = mentions.filter((e) => e.pubkey !== ctx.me).sort(byNewest)
  // Anyone can put the reader's key in a `p` tag of a reaction to somebody else's note: only reactions to notes the reader really wrote count.
  const candidate = reacts.filter((e) => e.pubkey !== ctx.me && reactionTarget(e))
  const ids = [...new Set(candidate.map((e) => reactionTarget(e)!))].slice(0, LIMIT)
  const mine = ids.length ? (await f.query({ ids, kinds: [1], limit: ids.length })).filter((n) => n.pubkey === ctx.me && ids.includes(n.id)) : []
  const targets = new Map(mine.map((n) => [n.id, n]))
  const reactions = candidate.filter((e) => targets.has(reactionTarget(e)!)).sort(byNewest)
  const signals = analyse([...notes, ...reactions])
  const judged = (e: Event): Judged => ({ event: e, verdict: judge(e, ctx, signals, settings) })
  return { notes: notes.map(judged), reactions: reactions.map(judged), targets, followers: followersOf(lists, ctx) }
}

/** Who follows the reader: the author of each follow list (kind 3) that really names them in a `p` tag. The newest list of each author counts once. */
export function followersOf(lists: Event[], ctx: Pick<Context, 'me' | 'muted'>): string[] {
  const newest = new Map<string, Event>()
  for (const e of lists) {
    if (e.kind !== 3 || e.pubkey === ctx.me || ctx.muted.has(e.pubkey) || !e.tags.some((t) => t[0] === 'p' && t[1] === ctx.me)) continue
    const o = newest.get(e.pubkey); if (!o || byNewest(e, o) < 0) newest.set(e.pubkey, e)
  }
  return [...newest.values()].sort(byNewest).map((e) => e.pubkey)
}

/** New since `seenAt` (unix seconds): what the filter shows and what it hides. A reaction counts once per (person, note), however many emoji. */
/** `known`: the followers already seen on an earlier visit; each follower not in it counts as one new thing (a follower is never "hidden": only muted accounts are left out). */
export function countNew(a: Activity, seenAt: number, known?: ReadonlySet<string>): { shown: number; hidden: number } {
  let shown = 0, hidden = 0
  if (known) shown += newFollowers(a, known).length
  const seen = new Set<string>()
  const tally = (isHidden: boolean) => { if (isHidden) hidden++; else shown++ }
  for (const { event, verdict } of a.notes) if (event.created_at > seenAt) tally(verdict.hidden)
  for (const { event, verdict } of a.reactions) {
    if (event.created_at <= seenAt) continue
    const key = `${event.pubkey}:${reactionTarget(event)}`
    if (seen.has(key)) continue
    seen.add(key); tally(verdict.hidden)
  }
  return { shown, hidden }
}

export interface ReactionGroup {
  target: Event
  /** Distinct emoji as they should be displayed, newest first (`+` is a like). */
  emojis: string[]
  /** Distinct people, newest first. */
  by: string[]
  latest: number
  /** Something in this group arrived after the reader's last visit. */
  fresh: boolean
}

export const showReaction = (content: string): string => (content === '+' ? '👍' : content === '-' ? '👎' : content || '👍')

/** The visible reactions to the reader's notes, grouped by note, the most recent group first. */
export function groupReactions(a: Activity, seenAt: number): ReactionGroup[] {
  const groups = new Map<string, ReactionGroup>()
  const have = new Set<string>()
  for (const { event, verdict } of a.reactions) {
    if (verdict.hidden) continue
    const id = reactionTarget(event)!, target = a.targets.get(id)!
    const g = groups.get(id) ?? { target, emojis: [], by: [], latest: 0, fresh: false }
    const emoji = showReaction(event.content)
    if (!have.has(`${id}:${normReaction(emoji)}`)) { have.add(`${id}:${normReaction(emoji)}`); g.emojis.push(emoji) }
    if (!g.by.includes(event.pubkey)) g.by.push(event.pubkey)
    g.latest = Math.max(g.latest, event.created_at); g.fresh ||= event.created_at > seenAt
    groups.set(id, g)
  }
  return [...groups.values()].sort((x, y) => y.latest - x.latest)
}

/** The followers that were not known before, in the order of the lists (newest first). */
export const newFollowers = (a: Pick<Activity, 'followers'>, known: ReadonlySet<string>): string[] => a.followers.filter((k) => !known.has(k))

/** The set of followers ever seen: it only grows, so a relay that does not return somebody today cannot make them look new tomorrow. */
export const MAX_KNOWN_FOLLOWERS = 20_000
export const mergeKnown = (known: ReadonlySet<string>, a: Pick<Activity, 'followers'>): Set<string> => new Set([...known, ...a.followers].slice(-MAX_KNOWN_FOLLOWERS))
export const parseKnown = (raw: string | null): Set<string> | null => {
  try { const v = JSON.parse(raw ?? 'null') as unknown; return Array.isArray(v) ? new Set(v.filter((x): x is string => typeof x === 'string' && HEX64.test(x)).slice(-MAX_KNOWN_FOLLOWERS)) : null } catch { return null }
}
