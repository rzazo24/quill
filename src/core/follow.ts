// Following and unfollowing (NIP-02, kind 3). The follow list is ONE event holding everybody you follow, and a new one REPLACES it: publishing a list built from a
// stale or incomplete copy would silently erase follows. So Quill only ever signs the reader's newest list with exactly ONE account added or removed, and the policy
// checks it against the base list it was built from.
import type { Event } from 'nostr-tools'
import type { Template } from '../sign/policy.js'

export const FOLLOW_LIST_KIND = 3
/** NIP-51: the accounts (and words) the reader muted. Its `content` may hold a private, encrypted part that Quill cannot read: it is kept exactly as it is. */
export const MUTE_LIST_KIND = 10000
/** More than this is not a list a person follows by hand: Quill does not rewrite it. */
export const MAX_FOLLOW_TAGS = 20_000
const HEX64 = /^[0-9a-f]{64}$/

/** The same machinery changes two lists: who the reader follows, and who they muted. */
export type FollowAction = 'follow' | 'unfollow' | 'mute' | 'unmute'
export const listKindOf = (a: FollowAction): number => (a === 'mute' || a === 'unmute' ? MUTE_LIST_KIND : FOLLOW_LIST_KIND)
const adds = (a: FollowAction): boolean => a === 'follow' || a === 'mute'
const actionFor = (kind: number, add: boolean): FollowAction => (kind === MUTE_LIST_KIND ? (add ? 'mute' : 'unmute') : add ? 'follow' : 'unfollow')
const isP = (t: string[], pubkey: string): boolean => t[0] === 'p' && t[1] === pubkey
const sameTag = (a: string[], b: string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i])

/** The accounts a follow list names, once each, in order. */
export function followPubkeys(list: Pick<Event, 'tags'>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of list.tags) if (t[0] === 'p' && HEX64.test(t[1] ?? '') && !seen.has(t[1]!)) { seen.add(t[1]!); out.push(t[1]!) }
  return out
}

/**
 * The next list: a copy of `base` (every tag, relay hint and petname kept, the old `content` kept) with `pubkey` added at the end, or all of its `p` tags removed.
 * Null when there is nothing to do (already followed / not followed), when it is not an account, when it is the reader themself, or when the list is too big.
 * A mute list may not exist yet (`base` null): then muting makes a new one with just that account (`me` keeps the reader from muting themself).
 */
export function followTemplate(base: Event | null, pubkey: string, action: FollowAction, now: number, me?: string): Template | null {
  const kind = listKindOf(action)
  if (!HEX64.test(pubkey)) return null
  if (!base) return kind === MUTE_LIST_KIND && action === 'mute' && me !== undefined && pubkey !== me ? { kind, content: '', tags: [['p', pubkey]], created_at: now } : null
  if (base.kind !== kind || pubkey === base.pubkey) return null
  const has = base.tags.some((t) => isP(t, pubkey))
  let tags: string[][]
  if (adds(action)) { if (has) return null; tags = [...base.tags.map((t) => [...t]), ['p', pubkey]] } else { if (!has) return null; tags = base.tags.filter((t) => !isP(t, pubkey)).map((t) => [...t]) }
  if (tags.length > MAX_FOLLOW_TAGS) return null
  return { kind, content: base.content, tags, created_at: Math.max(now, base.created_at + 1) }
}

/** What a template changes in its base list, or null when it is not exactly "one account added" or "one account's tags removed" with nothing else different. */
export function followChange(base: Event | null, t: Template, me?: string): { action: FollowAction; pubkey: string } | null {
  if (t.kind !== FOLLOW_LIST_KIND && t.kind !== MUTE_LIST_KIND) return null
  // a first mute list: nothing but the one account, nothing private
  if (!base) { const only = t.tags[0]; return t.kind === MUTE_LIST_KIND && me !== undefined && t.content === '' && t.tags.length === 1 && only!.length === 2 && only![0] === 'p' && HEX64.test(only![1]!) && only![1] !== me ? { action: 'mute', pubkey: only![1]! } : null }
  if (base.kind !== t.kind || t.content !== base.content || !(t.created_at > base.created_at)) return null
  if (t.tags.length > MAX_FOLLOW_TAGS || !t.tags.every((x) => Array.isArray(x) && x.every((v) => typeof v === 'string'))) return null
  // added: the same tags, then exactly ["p", key] for somebody not followed and not the reader
  if (t.tags.length === base.tags.length + 1) {
    const last = t.tags[t.tags.length - 1]!
    const prefixSame = base.tags.every((x, i) => sameTag(x, t.tags[i]!))
    return prefixSame && last.length === 2 && last[0] === 'p' && HEX64.test(last[1]!) && last[1] !== base.pubkey && !base.tags.some((x) => isP(x, last[1]!)) ? { action: actionFor(t.kind, true), pubkey: last[1]! } : null
  }
  // removed: all the p tags of ONE account are gone and everything else is untouched, in the same order
  if (t.tags.length < base.tags.length) {
    let i = 0
    while (i < t.tags.length && sameTag(base.tags[i]!, t.tags[i]!)) i++
    const gone = base.tags[i]
    if (!gone || gone[0] !== 'p' || !HEX64.test(gone[1] ?? '')) return null
    const expected = base.tags.filter((x) => !isP(x, gone[1]!))
    return expected.length === t.tags.length && expected.every((x, k) => sameTag(x, t.tags[k]!)) ? { action: actionFor(t.kind, false), pubkey: gone[1]! } : null
  }
  return null
}
