// Deleting one of the reader's own notes (NIP-09, kind 5): a request that names exactly that note. Relays usually honour it, but not all of them, and
// whoever already saw the note may keep a copy: the confirmation says so.
import type { Event } from 'nostr-tools'
import type { Template } from '../sign/policy.js'

export const DELETION_KIND = 5

export function deletionTemplate(target: Pick<Event, 'id' | 'kind'>, now: number): Template {
  return { kind: DELETION_KIND, content: '', tags: [['e', target.id], ['k', String(target.kind)]], created_at: now }
}

/** Is the template exactly the request to delete `target` (a note), and nothing more? */
export function isDeletionOf(target: Pick<Event, 'id' | 'kind'>, t: Template): boolean {
  return t.kind === DELETION_KIND && target.kind === 1 && t.content === '' && t.tags.length === 2
    && t.tags[0]!.length === 2 && t.tags[0]![0] === 'e' && t.tags[0]![1] === target.id
    && t.tags[1]!.length === 2 && t.tags[1]![0] === 'k' && t.tags[1]![1] === '1'
}
