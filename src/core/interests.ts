// The topics the reader cares about (Settings, this device only): a note that talks about one is MARKED, never moved or hidden. Plain words, no AI: a
// topic matches where a word starts with it ("relay" finds "relays"), accents and capitals aside, and a #tag of the note counts too.
import type { Event } from 'nostr-tools'
import { fold } from '../data/search.js'

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The reader's topics that this note talks about, in the reader's order (at most three named). */
export function interestsIn(e: Pick<Event, 'content' | 'tags'>, topics: readonly string[]): string[] {
  if (!topics.length) return []
  // references (nostr:npub…, nostr:nevent…) and web addresses are not what a note talks about: "nostr:" alone would match the topic "nostr"
  const text = fold(e.content.replace(/nostr:[a-z0-9]+/gi, ' ').replace(/https?:\/\/\S+/gi, ' ')), tags = e.tags.filter((t) => t[0] === 't').map((t) => fold(t[1] ?? ''))
  const out: string[] = []
  for (const raw of topics) {
    const topic = fold(raw.replace(/^#/, ''))
    if (!topic) continue
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escape(topic)}`, 'u')
    if (re.test(text) || tags.some((t) => t.startsWith(topic))) out.push(raw.replace(/^#/, ''))
    if (out.length === 3) break
  }
  return out
}
