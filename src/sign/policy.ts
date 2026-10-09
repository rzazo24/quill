// What Quill is willing to ask a signer to sign. The user's signer decides what it approves (low/medium/full trust); this is Quill's own rule,
// so that even a signer set to approve everything is only ever asked for notes, reactions and the reader's relay list, in the shapes Quill builds itself.
import { isReactionContent } from '../core/compose.js'
import { MAX_RELAYS, normalizeRelay } from '../net/relays.js'

/** NIP-65: the list of relays a person writes to and reads from. */
export const RELAY_LIST_KIND = 10002
export const ALLOWED_KINDS = [1, 7, RELAY_LIST_KIND] as const
export const MAX_NOTE_CHARS = 1000
export const MAX_SIGNATURES_PER_HOUR = 20

export interface Template { kind: number; content: string; tags: string[][]; created_at: number }

export type Problem = 'kind' | 'empty' | 'too-long' | 'reaction' | 'tags' | 'reaction-target' | 'relay-list'

const TAG_NAMES = new Set(['e', 'p', 't', 'k', 'a'])

/** Null when the template is fine, otherwise why not. */
export function checkTemplate(t: Template): Problem | null {
  if (!(ALLOWED_KINDS as readonly number[]).includes(t.kind)) return 'kind'
  if (t.kind === RELAY_LIST_KIND) { // exactly `["r", "wss://…"]` per relay, each one valid and tidy, no repeats, nothing else
    const urls = t.tags.map((x) => (x.length === 2 && x[0] === 'r' ? x[1]! : ''))
    const ok = t.content === '' && t.tags.length >= 1 && t.tags.length <= MAX_RELAYS && urls.every((u) => u !== '' && normalizeRelay(u) === u) && new Set(urls).size === urls.length
    return ok ? null : 'relay-list'
  }
  if (t.tags.length > 40 || !t.tags.every((tag) => Array.isArray(tag) && tag.length >= 2 && tag.length <= 4 && tag.every((v) => typeof v === 'string' && v.length <= 300) && TAG_NAMES.has(tag[0]!))) return 'tags'
  if (t.kind === 1) {
    if (!t.content.trim()) return 'empty'
    if ([...t.content].length > MAX_NOTE_CHARS) return 'too-long'
  } else {
    if (!isReactionContent(t.content)) return 'reaction'
    if (!t.tags.some((x) => x[0] === 'e') || !t.tags.some((x) => x[0] === 'p')) return 'reaction-target'
  }
  return null
}

/** Signatures made in the last hour (timestamps in seconds), pruned. */
export function recentSignatures(stamps: number[], nowSec: number): number[] {
  return stamps.filter((s) => Number.isFinite(s) && nowSec - s < 3600 && s <= nowSec + 60)
}

export const canSign = (stamps: number[], nowSec: number): boolean => recentSignatures(stamps, nowSec).length < MAX_SIGNATURES_PER_HOUR

/** The same tags, whatever order the signer returns them in? No: order is part of the event. Exact comparison. */
export const sameTags = (a: string[][], b: string[][]): boolean => a.length === b.length && a.every((t, i) => t.length === b[i]!.length && t.every((v, j) => v === b[i]![j]))
