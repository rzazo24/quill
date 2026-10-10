// Sharing a note (a repost, NIP-18, kind 6). The repost carries a COPY of the original note as its content, so what gets signed is checked closely: the copy must be a
// real, validly signed text note, exactly as it was published, and the tags must be exactly the pointer to it. Quill builds this shape itself and nothing else is signed.
import { verifyEvent, type Event } from 'nostr-tools'
import { normalizeRelay } from '../net/relays.js'
import type { Template } from '../sign/policy.js'

export const REPOST_KIND = 6
/** The biggest copy Quill shares (characters of its JSON): a note this size is longer than anything it shows. */
export const MAX_REPOST_JSON = 16_000
const HEX64 = /^[0-9a-f]{64}$/
const SIG = /^[0-9a-f]{128}$/

/** Can this note be shared from Quill? A text note whose copy is not too big. */
export const canRepost = (e: Event): boolean => e.kind === 1 && HEX64.test(e.id) && JSON.stringify(e).length <= MAX_REPOST_JSON

/** `relayHint` is where the note can be found (NIP-18 asks for one in the `e` tag); empty is allowed. */
export function repostTemplate(original: Event, relayHint: string, createdAt: number): Template {
  return { kind: REPOST_KIND, content: JSON.stringify(original), tags: [['e', original.id, relayHint], ['p', original.pubkey]], created_at: createdAt }
}

export type RepostProblem = 'repost' | 'repost-too-long'

export function checkRepost(t: Template): RepostProblem | null {
  if (t.content.length > MAX_REPOST_JSON) return 'repost-too-long'
  let o: Event
  try { o = JSON.parse(t.content) as Event } catch { return 'repost' }
  if (!o || typeof o !== 'object' || !HEX64.test(o.id) || !HEX64.test(o.pubkey) || o.kind !== 1 || typeof o.content !== 'string' || !Array.isArray(o.tags) || !Number.isInteger(o.created_at) || typeof o.sig !== 'string' || !SIG.test(o.sig)) return 'repost'
  if (Object.keys(o).sort().join() !== 'content,created_at,id,kind,pubkey,sig,tags') return 'repost' // exactly the seven fields of a note, nothing else
  if (JSON.stringify(o) !== t.content) return 'repost' // exactly as published: no hidden changes in the copy
  if (!verifyEvent(o)) return 'repost' // a real note, validly signed by its author
  const [e, p, ...more] = t.tags
  const hint = e?.[2]
  const okE = !!e && e[0] === 'e' && e[1] === o.id && (e.length === 2 || (e.length === 3 && (hint === '' || normalizeRelay(hint!) === hint)))
  const okP = !!p && p.length === 2 && p[0] === 'p' && p[1] === o.pubkey
  return okE && okP && more.length === 0 ? null : 'repost'
}
