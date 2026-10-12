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

/** NIP-22 comment: another way to reply, used by more and more apps. */
export const COMMENT_KIND = 1111

/** Reads the e and p tags. Marked tags (root/reply) win; old unmarked ones are read by position: first is the root, last the reply.
 *  A NIP-22 comment (kind 1111) says it differently: its ROOT is the upper-case E tag and the note it answers the lower-case e tag; for a comment
 *  on something that is not a note (an article, a web page…) there is no E, and only its parent counts. */
export function threadRefs(event: Pick<Event, 'tags'> & { kind?: number }): ThreadRefs {
  if (event.kind === COMMENT_KIND) {
    const people = [...new Set(event.tags.filter((t) => (t[0] === 'p' || t[0] === 'P') && HEX.test(t[1] ?? '')).map((t) => t[1]!))]
    const rootTag = event.tags.find((t) => t[0] === 'E' && HEX.test(t[1] ?? ''))?.[1]
    const parent = event.tags.find((t) => t[0] === 'e' && HEX.test(t[1] ?? ''))?.[1]
    const reply = parent ?? rootTag
    return reply ? { root: rootTag ?? reply, reply, people } : { people, reply: '' } // with no note above it (a comment on an article…), it is still a reply, never a root note
  }
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
export const isReply = (event: Pick<Event, 'tags'> & { kind?: number }): boolean => threadRefs(event).reply !== undefined
