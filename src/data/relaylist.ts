// The reader's relay list as Nostr knows it (NIP-65, kind 10002): read it, and build the event that publishes it.
import { RELAY_LIST_KIND, type Template } from '../sign/policy.js'
import { MAX_RELAYS, normalizeRelay } from '../net/relays.js'
import type { Fetcher } from '../net/fetcher.js'

/** The newest valid list the reader published (`null` when there is none). Read/write markers are ignored: Quill uses one list for everything. */
export async function loadPublishedRelays(f: Fetcher, me: string): Promise<string[] | null> {
  const events = (await f.query({ kinds: [RELAY_LIST_KIND], authors: [me], limit: 10 })).filter((e) => e.kind === RELAY_LIST_KIND && e.pubkey === me)
  const newest = events.sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1))[0]
  if (!newest) return null
  const list = [...new Set(newest.tags.filter((t) => t[0] === 'r').map((t) => normalizeRelay(t[1] ?? '')).filter((u): u is string => !!u))].slice(0, MAX_RELAYS)
  return list.length ? list : null
}

export const relayListTemplate = (list: string[], createdAt: number): Template => ({ kind: RELAY_LIST_KIND, content: '', tags: list.map((u) => ['r', u]), created_at: createdAt })

export type ListState = 'unknown' | 'none' | 'same' | 'differs'
/** Compared as sets: the order of a relay list means nothing. */
export const listState = (published: string[] | null | undefined, mine: string[]): ListState =>
  published === undefined ? 'unknown' : published === null ? 'none' : published.length === mine.length && mine.every((u) => published.includes(u)) ? 'same' : 'differs'
