// What happened around the reader's own notes while they were away: replies and mentions, and reactions to their notes. Everything goes through the
// same filter as the rest of the app, and the new-since-last-visit count only includes what the filter would SHOW (hidden things are counted apart).
import type { Event } from 'nostr-tools'
import { analyse, judge, type Context, type Judged, type Settings, DEFAULT_SETTINGS } from '../core/verdict.js'
import type { Fetcher } from '../net/fetcher.js'
import { normReaction } from './engaged.js'

const HEX64 = /^[0-9a-f]{64}$/
const LIMIT = 100
const byNewest = (a: Event, b: Event) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1)

export interface Activity {
  /** Replies and mentions from other people. */
  notes: Judged[]
  /** Reactions from other people to notes that really are the reader's. */
  reactions: Judged[]
  /** The reader's notes that were reacted to, by id (for their text). */
  targets: Map<string, Event>
}

/** NIP-25: the note reacted to is the LAST e tag. */
export const reactionTarget = (e: Pick<Event, 'tags'>): string | undefined => [...e.tags].reverse().find((t) => t[0] === 'e' && HEX64.test(t[1] ?? ''))?.[1]

export async function loadActivity(f: Fetcher, ctx: Context, settings: Settings = DEFAULT_SETTINGS): Promise<Activity> {
  const [mentions, reacts] = await Promise.all([f.query({ kinds: [1], '#p': [ctx.me], limit: LIMIT }), f.query({ kinds: [7], '#p': [ctx.me], limit: LIMIT })])
  const notes = mentions.filter((e) => e.pubkey !== ctx.me).sort(byNewest)
  // Anyone can put the reader's key in a `p` tag of a reaction to somebody else's note: only reactions to notes the reader really wrote count.
  const candidate = reacts.filter((e) => e.pubkey !== ctx.me && reactionTarget(e))
  const ids = [...new Set(candidate.map((e) => reactionTarget(e)!))].slice(0, LIMIT)
  const mine = ids.length ? (await f.query({ ids, kinds: [1], limit: ids.length })).filter((n) => n.pubkey === ctx.me && ids.includes(n.id)) : []
  const targets = new Map(mine.map((n) => [n.id, n]))
  const reactions = candidate.filter((e) => targets.has(reactionTarget(e)!)).sort(byNewest)
  const signals = analyse([...notes, ...reactions])
  const judged = (e: Event): Judged => ({ event: e, verdict: judge(e, ctx, signals, settings) })
  return { notes: notes.map(judged), reactions: reactions.map(judged), targets }
}

/** New since `seenAt` (unix seconds): what the filter shows and what it hides. A reaction counts once per (person, note), however many emoji. */
export function countNew(a: Activity, seenAt: number): { shown: number; hidden: number } {
  let shown = 0, hidden = 0
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
