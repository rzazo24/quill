// How much the network vouches for an account: the same score nostrclaw gives (same facts, same weights), so both tools agree. Built from what the
// reader's relays hold about who follows whom and who interacts with whom. A help to decide, not a verdict: anyone can make keys that follow each
// other, which is why the points that are hardest to fake (followers that are themselves followed, closeness to the reader) weigh most; "unknown"
// only means nothing vouches for it on these relays.
import type { Event } from 'nostr-tools'
import type { Context } from '../core/verdict.js'
import type { Fetcher } from '../net/fetcher.js'
import { newestPerAuthor } from './lists.js'

export type TrustLevel = 'established' | 'some' | 'unknown'
export interface TrustFacts {
  /** Distinct keys whose newest follow list names it (a lower bound: relays hold partial data). */
  followers: number
  /** Of those, how many are themselves followed by at least ESTABLISHED_FOLLOWERS keys. */
  establishedFollowers: number
  /** 0 = it is the reader, 1 = the reader follows it. */
  seedDistance?: 0 | 1
  /** How many of the accounts the reader follows follow it: the backing that a ring of fake accounts cannot buy. */
  networkFollowers: number
  /** How many of the accounts the reader follows have it in their (public) mute list. */
  mutedByNetwork: number
  /** Distinct OTHER keys that replied to, reacted to, reposted or mentioned it. */
  engagers: number
  /** The oldest of its events that were read. */
  oldestSeen?: number
  hasProfile: boolean
  now: number
}
export type TrustReason = { points: number; key: 'isYou' | 'youFollow' | 'network' | 'followers' | 'established' | 'engagers' | 'seen30' | 'seen7' | 'profile' | 'mutedByNetwork'; n?: number }
export interface TrustScore { score: number; level: TrustLevel; reasons: TrustReason[] }

export const ESTABLISHED_FOLLOWERS = 3
const DAY = 86400
/** nostrclaw's weights (src/trust.ts there): change both or neither. Measured on real accounts (2026-10-12): counting followers, "established"
 *  followers and engagers rated 13 of 15 spam accounts "some backing" (bot rings inflate exactly those), so they only fine-tune the number now,
 *  and the LEVEL comes from the reader's own network. */
export const TRUST_WEIGHTS = {
  isTrusted: 60, followedByTrusted: 40,
  network1: 25, network3: 32, network10: 40,
  followers1: 2, followers5: 5, followers20: 8,
  established1: 4, established5: 8, established15: 12,
  engagers1: 4, engagers3: 8,
  seenOver7Days: 4, seenOver30Days: 8, hasProfile: 4,
  mutedBy1: -15, mutedBy3: -30, mutedBy5: -50,
} as const

export function scoreTrust(f: TrustFacts): TrustScore {
  const W = TRUST_WEIGHTS, reasons: TrustReason[] = []
  let score = 0
  const add = (points: number, key: TrustReason['key'], n?: number) => { score += points; reasons.push(n === undefined ? { points, key } : { points, key, n }) }
  if (f.seedDistance === 0) add(W.isTrusted, 'isYou')
  else if (f.seedDistance === 1) add(W.followedByTrusted, 'youFollow')
  const k = f.networkFollowers
  if (k >= 10) add(W.network10, 'network', k); else if (k >= 3) add(W.network3, 'network', k); else if (k >= 1) add(W.network1, 'network', k)
  if (f.followers >= 20) add(W.followers20, 'followers', f.followers)
  else if (f.followers >= 5) add(W.followers5, 'followers', f.followers)
  else if (f.followers >= 1) add(W.followers1, 'followers', f.followers)
  if (f.establishedFollowers >= 15) add(W.established15, 'established', f.establishedFollowers)
  else if (f.establishedFollowers >= 5) add(W.established5, 'established', f.establishedFollowers)
  else if (f.establishedFollowers >= 1) add(W.established1, 'established', f.establishedFollowers)
  if (f.engagers >= 3) add(W.engagers3, 'engagers', f.engagers)
  else if (f.engagers >= 1) add(W.engagers1, 'engagers', f.engagers)
  const days = f.oldestSeen === undefined ? undefined : Math.floor((f.now - f.oldestSeen) / DAY)
  if (days !== undefined && days >= 30) add(W.seenOver30Days, 'seen30', days)
  else if (days !== undefined && days >= 7) add(W.seenOver7Days, 'seen7', days)
  if (f.hasProfile) add(W.hasProfile, 'profile')
  const m = f.mutedByNetwork
  if (m >= 5) add(W.mutedBy5, 'mutedByNetwork', m); else if (m >= 3) add(W.mutedBy3, 'mutedByNetwork', m); else if (m >= 1) add(W.mutedBy1, 'mutedByNetwork', m)
  score = Math.max(0, Math.min(100, score))
  // The level says who vouches for it IN YOUR NETWORK (nothing a ring of fake accounts can buy): you or 3+ of your follows -> established; one of your
  // follows -> some backing; nobody in your network -> unknown, however many followers it has elsewhere. Being muted by your network lowers it.
  let level: TrustLevel = f.seedDistance !== undefined || k >= 3 ? 'established' : k >= 1 ? 'some' : 'unknown'
  if (m >= 5) level = 'unknown'; else if (m >= 3) level = level === 'established' ? 'some' : 'unknown'
  return { score, level, reasons }
}

const HEX64 = /^[0-9a-f]{64}$/
const followed = (e: Event): string[] => e.tags.filter((t) => t[0] === 'p' && HEX64.test(t[1] ?? '')).map((t) => t[1]!)

/** For each target, the keys whose newest follow list names it (self-follows do not count). */
export function followersOf(lists: Event[], targets: string[]): Map<string, Set<string>> {
  const out = new Map(targets.map((t) => [t, new Set<string>()]))
  for (const [author, e] of newestPerAuthor(lists.filter((x) => x.kind === 3))) for (const p of followed(e)) if (p !== author) out.get(p)?.add(author)
  return out
}

/** At most this many followers are checked for being "established" (two relay questions of a hundred each). */
export const MAX_CHECKED_FOLLOWERS = 200

/** The facts about one account, asked of the reader's relays. `own`: its events already read (profile, notes), for its age and whether it has a profile. */
export async function loadTrust(f: Fetcher, pubkey: string, ctx: Context, own: Event[], now: number): Promise<TrustScore> {
  const [lists, engage, mutes] = await Promise.all([f.query({ kinds: [3], '#p': [pubkey], limit: 1000 }), f.query({ kinds: [1, 6, 7, 16], '#p': [pubkey], limit: 300 }), f.query({ kinds: [10000], '#p': [pubkey], limit: 500 })])
  const followers = [...(followersOf(lists, [pubkey]).get(pubkey) ?? [])]
  const checked = followers.slice(0, MAX_CHECKED_FOLLOWERS), second: Event[] = []
  for (let i = 0; i < checked.length; i += 100) second.push(...await f.query({ kinds: [3], '#p': checked.slice(i, i + 100), limit: 3000 }))
  const theirs = followersOf(second, checked)
  const established = checked.filter((k) => (theirs.get(k)?.size ?? 0) >= ESTABLISHED_FOLLOWERS).length
  const engagers = new Set(engage.filter((e) => e.pubkey !== pubkey && e.tags.some((t) => t[0] === 'p' && t[1] === pubkey)).map((e) => e.pubkey)).size
  const d = pubkey === ctx.me ? 0 : ctx.follows.has(pubkey) ? 1 : undefined
  const networkFollowers = followers.filter((k) => ctx.follows.has(k)).length
  // the newest mute list of each of your follows that names it (an older list may name it and the newest no longer)
  const mutedByNetwork = [...newestPerAuthor(mutes.filter((e) => e.kind === 10000 && ctx.follows.has(e.pubkey)))].filter(([, e]) => e.tags.some((t) => t[0] === 'p' && t[1] === pubkey)).length
  const mine = own.filter((e) => e.pubkey === pubkey)
  const oldestSeen = mine.length ? Math.min(...mine.map((e) => e.created_at)) : undefined
  return scoreTrust({ followers: followers.length, establishedFollowers: established, networkFollowers, mutedByNetwork, ...(d === undefined ? {} : { seedDistance: d }), engagers, ...(oldestSeen === undefined ? {} : { oldestSeen }), hasProfile: mine.some((e) => e.kind === 0), now })
}
