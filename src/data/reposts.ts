// Reposts (NIP-18): kind 6 (a repost of a text note) and kind 16 (a generic repost). The repost event only POINTS at the original, and may carry a copy of it in its
// content. Nothing in it is trusted: the copy is used only when its signature is valid and it is exactly the note the repost points at.
import { verifyEvent, type Event } from 'nostr-tools'
import { queryAuthors, type Fetcher } from '../net/fetcher.js'

export const REPOST_KINDS = [6, 16]
const HEX64 = /^[0-9a-f]{64}$/
const MAX_COPY = 20_000 // characters: a copy larger than any text note is not parsed

export interface RepostRef { reposter: string; at: number; targetId: string; /** A valid copy of the original that came inside the repost, if any. */ copy: Event | null }

/** The note a repost points at is its LAST `e` tag. */
const targetOf = (e: Pick<Event, 'tags'>): string | undefined => [...e.tags].reverse().find((t) => t[0] === 'e' && HEX64.test(t[1] ?? ''))?.[1]

export function repostRefs(events: Event[], verify: (e: Event) => boolean = verifyEvent): RepostRef[] {
  const out: RepostRef[] = []
  for (const e of events) {
    if (!REPOST_KINDS.includes(e.kind)) continue
    const targetId = targetOf(e)
    if (!targetId) continue
    if (e.kind === 16 && e.tags.some((t) => t[0] === 'k' && t[1] !== '1')) continue // a generic repost of something that is not a text note
    out.push({ reposter: e.pubkey, at: e.created_at, targetId, copy: copyOf(e.content, targetId, verify) })
  }
  return out
}

function copyOf(content: string, targetId: string, verify: (e: Event) => boolean): Event | null {
  if (!content || content.length > MAX_COPY) return null
  try {
    const o = JSON.parse(content) as Event
    if (!o || typeof o !== 'object' || o.id !== targetId || o.kind !== 1 || typeof o.content !== 'string' || !Array.isArray(o.tags)) return null
    return verify(o) ? o : null
  } catch { return null }
}

export interface FeedItem { event: Event; repostedBy: string[]; /** When it counts for ordering: its own time or the latest repost of it. */ at: number }

/** One entry per note: the notes of the people followed, plus the notes they reposted, newest first. A note that was both posted and reposted is one entry. */
export function mergeFeed(roots: Event[], refs: RepostRef[], originals: ReadonlyMap<string, Event>, limit: number): FeedItem[] {
  const items = new Map<string, FeedItem>()
  for (const e of roots) items.set(e.id, { event: e, repostedBy: [], at: e.created_at })
  for (const r of [...refs].sort((a, b) => b.at - a.at)) {
    const original = originals.get(r.targetId) ?? r.copy
    if (!original || original.kind !== 1 || original.pubkey === r.reposter) continue
    const item = items.get(original.id) ?? { event: original, repostedBy: [], at: 0 }
    if (!item.repostedBy.includes(r.reposter)) item.repostedBy.push(r.reposter)
    item.at = Math.max(item.at, r.at)
    items.set(original.id, item)
  }
  return [...items.values()].sort((a, b) => b.at - a.at || (a.event.id < b.event.id ? -1 : 1)).slice(0, limit)
}

/** The originals the reposts point at that did not come with a valid copy, from the relays (a hundred ids at a time). */
export async function fetchOriginals(f: Fetcher, refs: RepostRef[]): Promise<Map<string, Event>> {
  const out = new Map<string, Event>()
  for (const r of refs) if (r.copy) out.set(r.targetId, r.copy)
  const missing = [...new Set(refs.filter((r) => !r.copy).map((r) => r.targetId))]
  for (let i = 0; i < missing.length; i += 100) {
    const ids = missing.slice(i, i + 100)
    for (const e of await f.query({ ids, kinds: [1], limit: ids.length })) if (ids.includes(e.id) && e.kind === 1) out.set(e.id, e)
  }
  return out
}

export async function loadRepostRefs(f: Fetcher, authors: string[], limit: number): Promise<RepostRef[]> {
  return repostRefs(await queryAuthors(f, { kinds: REPOST_KINDS, limit }, authors)).sort((a, b) => b.at - a.at).slice(0, limit)
}
