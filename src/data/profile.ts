// The page of one account: what its profile says (as text only: pictures and banners are never loaded), how many accounts it follows, which of YOUR follows follow
// it, and its notes judged by the filter. Everything here was written by a stranger and is treated as text.
import type { Event } from 'nostr-tools'
import { cleanText } from '../core/text.js'
import { judgeAll, type Context, type Judged, type Settings, DEFAULT_SETTINGS } from '../core/verdict.js'
import type { Fetcher } from '../net/fetcher.js'
import { nameOf, newestPerAuthor } from './lists.js'
import type { Session } from './session.js'

export const PROFILE_NOTES = 200
const HEX64 = /^[0-9a-f]{64}$/

export interface ProfileInfo {
  pubkey: string
  name?: string
  about?: string
  /** What the profile claims (a NIP-05 name and a website), shown as plain text: nothing is looked up or opened. */
  nip05?: string
  website?: string
  /** How many accounts its newest follow list names; null when no list was found. */
  following: number | null
  /** Your follows that follow this account, in a steady order. */
  via: string[]
}

const text = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? cleanText(v, max).trim() || undefined : undefined)

/** The fields of a kind 0 event; never throws. */
export function profileFields(e: Pick<Event, 'content'> | undefined): Pick<ProfileInfo, 'name' | 'about' | 'nip05' | 'website'> {
  if (!e) return {}
  try {
    const p = JSON.parse(e.content) as Record<string, unknown>
    return { name: nameOf(e), about: text(p.about, 1000), nip05: text(p.nip05, 80), website: text(p.website, 100) }
  } catch { return {} }
}

export const followingCount = (list: Pick<Event, 'tags'> | undefined): number | null => (list ? new Set(list.tags.filter((t) => t[0] === 'p' && HEX64.test(t[1] ?? '')).map((t) => t[1])).size : null)

/** Your follows whose follow list names this account. */
export function followedVia(s: Pick<Session, 'follows' | 'graphInfo'>, pubkey: string): string[] {
  const out: string[] = []
  for (const [owner, list] of s.graphInfo.lists) if (s.follows.has(owner) && list.includes(pubkey)) out.push(owner)
  return out.sort((a, b) => (a < b ? -1 : 1))
}

export async function loadProfile(f: Fetcher, pubkey: string, s: Session, ctx: Context, settings: Settings = DEFAULT_SETTINGS): Promise<{ info: ProfileInfo; notes: Judged[] }> {
  const [meta, notes] = await Promise.all([f.query({ kinds: [0, 3], authors: [pubkey], limit: 20 }), f.query({ kinds: [1], authors: [pubkey], limit: PROFILE_NOTES })])
  const newest = (kind: number) => newestPerAuthor(meta.filter((e) => e.kind === kind && e.pubkey === pubkey)).get(pubkey)
  const info: ProfileInfo = { pubkey, ...profileFields(newest(0)), following: followingCount(newest(3)), via: followedVia(s, pubkey) }
  // you opened this account on purpose: "outside your network" would only hide everything it wrote; the other rules (muted, bursts, repeats, links) still apply
  const here: Settings = { ...settings, rules: { ...settings.rules, outsideNetwork: false } }
  const mine = notes.filter((e) => e.kind === 1 && e.pubkey === pubkey).sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1))
  return { info, notes: judgeAll(mine, ctx, here) }
}
