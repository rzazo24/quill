// What the reader has already done to each note: which reactions they gave and whether they replied. Read from the relays (so it includes what they did
// from other apps or other days) and kept up to date locally when they react or reply here. Pure parsing + a small mutable index.
import type { Event } from 'nostr-tools'
import { threadRefs } from '../core/thread.js'
import type { Fetcher } from '../net/fetcher.js'

/** Emoji with or without the "emoji presentation" selector are the same reaction (❤ and ❤️). `+` stays `+` (a like). */
export const normReaction = (content: string): string => content.replace(/️/g, '')

const HEX64 = /^[0-9a-f]{64}$/

export interface Mine { reactions: ReadonlySet<string>; replied: boolean }
const NONE: Mine = { reactions: new Set(), replied: false }

export class Engagement {
  private readonly reacted = new Map<string, Set<string>>()
  private readonly replies = new Set<string>()

  /** What was done to this note (never undefined). */
  of(noteId: string): Mine { return { reactions: this.reacted.get(noteId) ?? NONE.reactions, replied: this.replies.has(noteId) } }
  addReaction(noteId: string, content: string): void {
    const c = normReaction(content)
    if (HEX64.test(noteId) && c) this.reacted.set(noteId, (this.reacted.get(noteId) ?? new Set()).add(c))
  }
  addReply(noteId: string): void { if (HEX64.test(noteId)) this.replies.add(noteId) }
}

/** `events` are the reader's own reactions (kind 7) and notes (kind 1); anything else, or anyone else's, is ignored. */
export function engagementOf(events: Event[], me: string): Engagement {
  const e = new Engagement()
  for (const ev of events) {
    if (ev.pubkey !== me) continue
    if (ev.kind === 7) {
      const target = [...ev.tags].reverse().find((t) => t[0] === 'e' && HEX64.test(t[1] ?? ''))?.[1] // NIP-25: the LAST e tag is the note reacted to
      if (target) e.addReaction(target, ev.content)
    } else if (ev.kind === 1) {
      const to = threadRefs(ev).reply
      if (to) e.addReply(to)
    }
  }
  return e
}

export async function loadEngagement(f: Fetcher, me: string): Promise<Engagement> {
  const [reactions, notes] = await Promise.all([f.query({ kinds: [7], authors: [me], limit: 500 }), f.query({ kinds: [1], authors: [me], limit: 300 })])
  return engagementOf([...reactions, ...notes], me)
}
