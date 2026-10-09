// Where a note sits in a thread (NIP-10). Pure: it only reads the tags.
import type { Event } from 'nostr-tools'

export interface ThreadRefs {
  /** The first note of the thread, if the note is a reply. */
  root?: string
  /** The note this one answers directly. For a first-level reply it is the root. */
  reply?: string
  /** Keys mentioned with p tags (they get notified). */
  people: string[]
}

const HEX = /^[0-9a-f]{64}$/

/** Reads the e and p tags. Marked tags (root/reply) win; old unmarked ones are read by position: first is the root, last the reply. */
export function threadRefs(event: Pick<Event, 'tags'>): ThreadRefs {
  const e = event.tags.filter((t) => t[0] === 'e' && HEX.test(t[1] ?? '') && t[3] !== 'mention')
  const people = [...new Set(event.tags.filter((t) => t[0] === 'p' && HEX.test(t[1] ?? '')).map((t) => t[1]!))]
  if (!e.length) return { people }
  const marked = (m: string) => e.find((t) => t[3] === m)?.[1]
  let root = marked('root'), reply = marked('reply')
  if (root || reply) { root ??= reply; reply ??= root; return { root, reply, people } }
  root = e[0]![1]; reply = e[e.length - 1]![1]
  return { root, reply, people }
}

/** A reply or a root note. */
export const isReply = (event: Pick<Event, 'tags'>): boolean => threadRefs(event).reply !== undefined
