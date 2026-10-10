// The reader's own follow list, for changing it. A follow-list change REPLACES the list, so before building one Quill reads the newest list from the relays right then,
// and refuses to go on if it does not look like the list it has been seeing (a stale or partial copy would make the new list erase follows).
import type { Event } from 'nostr-tools'
import { followPubkeys, FOLLOW_LIST_KIND } from '../core/follow.js'
import type { Fetcher } from '../net/fetcher.js'
import { newestPerAuthor } from './lists.js'

/** The newest follow list of the reader across the relays (what a relay holds may be an older version), or null when none was found. */
export async function loadFollowList(f: Fetcher, me: string): Promise<Event | null> {
  const lists = (await f.query({ kinds: [FOLLOW_LIST_KIND], authors: [me], limit: 20 })).filter((e) => e.kind === FOLLOW_LIST_KIND && e.pubkey === me)
  return newestPerAuthor(lists).get(me) ?? null
}

/** How many of the accounts seen before may be missing from the list found now without it being suspicious (a few were unfollowed elsewhere). */
export const shrinkMargin = (known: number): number => Math.max(3, Math.floor(known * 0.05))

export type BaseVerdict = { ok: true } | { ok: false; why: 'none' | 'shrunk'; known: number; found: number }

/** Is this a list Quill can build on? Not when none was found, nor when it lacks many of the accounts the reader was seen to follow. */
export function checkBase(base: Event | null, known: ReadonlySet<string> | null): BaseVerdict {
  const knownCount = known?.size ?? 0
  if (!base) return { ok: false, why: 'none', known: knownCount, found: 0 }
  const now = new Set(followPubkeys(base))
  if (!known || known.size === 0) return { ok: true }
  const missing = [...known].filter((k) => !now.has(k)).length
  return missing > shrinkMargin(known.size) ? { ok: false, why: 'shrunk', known: known.size, found: now.size } : { ok: true }
}

/** What to remember as "the list the reader follows": today's list, unless it is suspiciously shorter than the one remembered (then the old one stays). */
export function nextKnown(known: ReadonlySet<string> | null, now: ReadonlySet<string>): Set<string> {
  if (!known || known.size === 0) return new Set(now)
  const missing = [...known].filter((k) => !now.has(k)).length
  return missing > shrinkMargin(known.size) ? new Set(known) : new Set(now)
}

/** A copy of the reader's list from before a change, kept on the device (a signed event: nothing in it is lost). The last few only. */
export const MAX_BACKUPS = 3
export function addBackup(kept: Event[], base: Event): Event[] {
  return [base, ...kept.filter((e) => e.id !== base.id)].slice(0, MAX_BACKUPS)
}
export function parseBackups(raw: string | null): Event[] {
  try {
    const v = JSON.parse(raw ?? 'null') as unknown
    return Array.isArray(v) ? (v as Event[]).filter((e) => e && typeof e === 'object' && e.kind === FOLLOW_LIST_KIND && typeof e.id === 'string' && Array.isArray(e.tags)).slice(0, MAX_BACKUPS) : []
  } catch { return [] }
}
