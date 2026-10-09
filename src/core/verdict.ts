// The filter. Every note gets a VERDICT: shown or hidden, by which rule, and why. A hidden note is never just gone: the interface folds
// it into one line that says what the rule saw. Pure functions over events; nothing here touches the network or the page.
//
// Principles carried over from nostrclaw's triage (learned on real data):
//  - Behaviour is evidence; absence of data is not. A key with no profile, or a graph that has not loaded yet, never hides anything alone.
//  - People you chose (yourself, your follows) are never hidden by behaviour rules. Only your own mutes hide them.
//  - Short greetings ("gm", "Azul") repeated by many keys are greetings, not spam: a text must be distinctive (3+ words or a link).
import type { Event } from 'nostr-tools'
import { burstOf, hasLink, isDistinctive, normalizeText } from './text.js'

export type RuleId = 'own' | 'followed' | 'muted-author' | 'muted-word' | 'repeated-text' | 'burst' | 'link-only' | 'outside-network' | 'default'

export interface Verdict {
  hidden: boolean
  rule: RuleId
  /** Numbers and words the interface puts in its sentence (translatable): e.g. { shared: 3, total: 4 }. */
  params: Record<string, number | string>
}

export interface Settings {
  rules: { repeatedText: boolean; burst: boolean; linkOnly: boolean; outsideNetwork: boolean }
  /** Hops in the follow graph that still count as inside your network: 1 = people you follow, 2 = and the people they follow. */
  maxDistance: number
  /** Events by one key within 60 s that count as a burst. */
  burstEvents: number
}

export const DEFAULT_SETTINGS: Settings = {
  rules: { repeatedText: true, burst: true, linkOnly: true, outsideNetwork: true },
  maxDistance: 2,
  burstEvents: 5,
}

/** The follow graph around you. Until it is loaded, "outside the network" is unknown and hides nothing. */
export interface Graph {
  loaded: boolean
  /** Hops from you (1 = you follow them) or null when no path was found within the depth that was loaded. */
  distance(pubkey: string): number | null
}

export interface Context {
  me: string
  follows: ReadonlySet<string>
  muted: ReadonlySet<string>
  mutedWords: readonly string[]
  graph: Graph
}

/** What the batch of events shows about each key, computed once and shared by all verdicts. */
export interface Signals {
  /** Per author: how many of their texts also appear (same normalised text) from other keys, out of how many texts they have. */
  sharedText: Map<string, { shared: number; total: number }>
  /** Event ids whose distinctive text is also posted by another key. */
  sharedIds: Set<string>
  bursts: Map<string, { events: number; seconds: number }>
  /** Per author: texts with a link, out of all texts (only meaningful with 3 or more texts). */
  links: Map<string, { withLink: number; total: number }>
}

const isText = (e: Event) => e.kind === 1

export function analyse(events: Event[]): Signals {
  const texts = events.filter(isText)
  const byKey = new Map<string, Set<string>>() // normalised text -> authors
  const keyOf = new Map<string, string>() // event id -> normalised text (distinctive only)
  for (const e of texts) {
    const n = normalizeText(e.content)
    if (!n || !isDistinctive(n)) continue
    keyOf.set(e.id, n)
    byKey.set(n, (byKey.get(n) ?? new Set()).add(e.pubkey))
  }
  const sharedIds = new Set<string>()
  for (const [id, n] of keyOf) if ((byKey.get(n)?.size ?? 0) >= 2) sharedIds.add(id)

  const byAuthor = new Map<string, Event[]>()
  for (const e of events) byAuthor.set(e.pubkey, [...(byAuthor.get(e.pubkey) ?? []), e])
  const sharedText = new Map<string, { shared: number; total: number }>()
  const bursts = new Map<string, { events: number; seconds: number }>()
  const links = new Map<string, { withLink: number; total: number }>()
  for (const [pk, list] of byAuthor) {
    bursts.set(pk, burstOf(list.map((e) => e.created_at), 60))
    const t = list.filter(isText)
    sharedText.set(pk, { shared: t.filter((e) => sharedIds.has(e.id)).length, total: t.length })
    links.set(pk, { withLink: t.filter((e) => hasLink(e.content)).length, total: t.length })
  }
  return { sharedText, sharedIds, bursts, links }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whole-word, case-insensitive match that works with any alphabet. */
export function mentionsWord(text: string, word: string): boolean {
  const w = word.trim()
  if (!w) return false
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w)}($|[^\\p{L}\\p{N}])`, 'iu').test(text)
}

const shown = (rule: RuleId, params: Verdict['params'] = {}): Verdict => ({ hidden: false, rule, params })
const hidden = (rule: RuleId, params: Verdict['params'] = {}): Verdict => ({ hidden: true, rule, params })

/** Decides one note. The order of the checks is the order of precedence, and it is part of the behaviour (see the tests). */
export function judge(e: Event, ctx: Context, signals: Signals, settings: Settings = DEFAULT_SETTINGS): Verdict {
  if (e.pubkey === ctx.me) return shown('own')
  if (ctx.muted.has(e.pubkey)) return hidden('muted-author')
  const word = ctx.mutedWords.find((w) => mentionsWord(e.content, w))
  if (word !== undefined) return hidden('muted-word', { word })
  if (ctx.follows.has(e.pubkey)) return shown('followed')

  const { rules } = settings
  if (rules.repeatedText && signals.sharedIds.has(e.id)) {
    const s = signals.sharedText.get(e.pubkey)
    if (s && s.total >= 2 && s.shared / s.total >= 0.5) return hidden('repeated-text', { shared: s.shared, total: s.total })
  }
  const b = signals.bursts.get(e.pubkey)
  if (rules.burst && b && b.events >= settings.burstEvents) return hidden('burst', { events: b.events, seconds: b.seconds })
  const l = signals.links.get(e.pubkey)
  if (rules.linkOnly && l && l.total >= 3 && l.withLink / l.total >= 0.8) return hidden('link-only', { withLink: l.withLink, total: l.total })

  if (rules.outsideNetwork && ctx.graph.loaded) {
    const d = ctx.graph.distance(e.pubkey)
    if (d === null || d > settings.maxDistance) return hidden('outside-network', { max: settings.maxDistance, hops: d ?? 'none' })
  }
  return shown('default')
}

export interface Judged { event: Event; verdict: Verdict }

/** Judges a whole batch (the signals are computed once). */
export function judgeAll(events: Event[], ctx: Context, settings: Settings = DEFAULT_SETTINGS): Judged[] {
  const signals = analyse(events)
  return events.map((event) => ({ event, verdict: judge(event, ctx, signals, settings) }))
}

/** What the filter did to a batch: the counter the interface shows ("12 hidden: 7 outside your network, 5 repeated text"). */
export function tally(judged: Judged[]): { shown: number; hidden: number; byRule: Partial<Record<RuleId, number>> } {
  const byRule: Partial<Record<RuleId, number>> = {}
  let h = 0
  for (const { verdict } of judged) if (verdict.hidden) { h++; byRule[verdict.rule] = (byRule[verdict.rule] ?? 0) + 1 }
  return { shown: judged.length - h, hidden: h, byRule }
}
