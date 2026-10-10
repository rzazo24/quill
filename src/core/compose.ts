// Building the tags of a reaction, a reply, hashtags and mentions. Pure functions: Quill fetches the event being answered, this decides the tags.
// The point of doing it here and not by hand: a wrong tag (a reply that does not thread, a reaction without the author) is a public, permanent mistake.
import { nip19, type Event } from 'nostr-tools'

const HEX64 = /^[0-9a-f]{64}$/i
const MAX_P = 8
const MAX_T = 10

/** `+`, `-` or a single emoji (with its joiners and skin tones). Custom `:shortcode:` emoji need an extra tag and are not supported. */
export function isReactionContent(c: string): boolean {
  if (c === '+' || c === '-') return true
  return c.length <= 24 && /^\p{Extended_Pictographic}[\p{Extended_Pictographic}‍️\u{1F3FB}-\u{1F3FF}⃣]*$/u.test(c)
}

/** NIP-25: the event reacted to (`e`), its author (`p`) and its kind (`k`); an addressable event also gets its `a` coordinate. */
export function reactionTags(target: Event): string[][] {
  const tags = [['e', target.id], ['p', target.pubkey], ['k', String(target.kind)]]
  if (target.kind >= 30000 && target.kind < 40000) {
    const d = target.tags.find((t) => t[0] === 'd')?.[1] ?? ''
    tags.push(['a', `${target.kind}:${target.pubkey}:${d}`])
  }
  return tags
}

/**
 * NIP-10 (marked) tags for a reply to a kind-1 note. A direct reply to a root note carries only the `root` marker; a reply deeper in a thread carries the
 * `root` of the thread and the `reply` to the parent. The parent's author goes first among the `p` tags, then the people the parent addressed (up to 8 in all).
 */
export function replyTags(target: Event): string[][] {
  if (target.kind !== 1) throw new Error(`replying to a kind ${target.kind} event needs NIP-22 comments, which Quill does not build; only replies to notes (kind 1) are supported`)
  const es = target.tags.filter((t) => t[0] === 'e' && HEX64.test(t[1] ?? ''))
  const marked = es.find((t) => t[3] === 'root')
  const root = marked ?? (es.length && !es.some((t) => t[3]) ? es[0] : undefined) // legacy positional tags: the first `e` is the root
  const tags: string[][] = root ? [['e', root[1]!.toLowerCase(), root[2] ?? '', 'root'], ['e', target.id, '', 'reply']] : [['e', target.id, '', 'root']]
  const people = [target.pubkey, ...target.tags.filter((t) => t[0] === 'p' && HEX64.test(t[1] ?? '')).map((t) => t[1]!.toLowerCase())]
  for (const pk of [...new Set(people)].slice(0, MAX_P)) tags.push(['p', pk])
  return tags
}

/** `#word` in the text becomes a lower-case `t` tag (NIP-24); pure numbers (`#1`) are not hashtags. */
export function hashtagTags(content: string): string[][] {
  const out: string[][] = []
  for (const m of content.matchAll(/(^|[\s(])#([\p{L}\p{N}_]{1,50})/gu)) {
    const w = m[2]!.toLowerCase()
    if (/^\d+$/.test(w) || out.some((t) => t[1] === w)) continue
    out.push(['t', w])
    if (out.length >= MAX_T) break
  }
  return out
}

/** `nostr:npub1…` / `nostr:nprofile1…` in the text (NIP-27) become `p` tags, so the person is notified. Invalid references are ignored. */
export function mentionTags(content: string): string[][] {
  const out: string[][] = []
  for (const m of content.matchAll(/nostr:(npub1[a-z0-9]{20,}|nprofile1[a-z0-9]{20,})/g)) {
    try {
      const d = nip19.decode(m[1]!)
      const pk = d.type === 'npub' ? d.data : d.type === 'nprofile' ? d.data.pubkey : ''
      if (pk && !out.some((t) => t[1] === pk)) out.push(['p', pk])
    } catch { /* not a valid reference */ }
    if (out.length >= MAX_P) break
  }
  return out
}

/** The tags the user asked for first, then the automatic ones that are not already there (same tag name and first value). */
export function mergeTags(explicit: string[][], auto: string[][]): string[][] {
  const have = new Set(explicit.map((t) => `${t[0]}\u0000${t[1]}`))
  return [...explicit, ...auto.filter((t) => !have.has(`${t[0]}\u0000${t[1]}`))]
}

/** A quote (NIP-18): the reader's own comment, then a NIP-21 reference to the note quoted, which clients show as the embedded note. */
export function quoteRef(target: Event, hint: string): string {
  return 'nostr:' + nip19.neventEncode({ id: target.id, relays: hint ? [hint] : [], author: target.pubkey, kind: target.kind })
}
/** What a person copies to point at a note from elsewhere. Both are built on an nevent (the note's id plus who wrote it and where to look), which other clients find more reliably than a bare note1…. The id carries the `nostr:` prefix (NIP-21) so pasted into a note it shows as a reference; the link opens in any browser (njump). */
const nevent = (target: Event, hints: readonly string[]): string => nip19.neventEncode({ id: target.id, relays: [...hints], author: target.pubkey, kind: target.kind })
export const noteId = (target: Event, hints: readonly string[] = []): string => 'nostr:' + nevent(target, hints)
export const noteLink = (target: Event, hints: readonly string[] = []): string => 'https://njump.me/' + nevent(target, hints)
/** The `q` tag points at the note quoted (with where to find it and who wrote it), and the author is mentioned so they are told. */
export const quoteTags = (target: Event, hint: string): string[][] => [['q', target.id, hint, target.pubkey], ['p', target.pubkey]]
export const quoteContent = (text: string, target: Event, hint: string): string => `${text.trim()}\n\n${quoteRef(target, hint)}`
/** How many characters of the 1000 the reference takes (and the blank line before it): what the reader's comment has left is the rest. */
export const quoteReserve = (target: Event, hint: string): number => [...`\n\n${quoteRef(target, hint)}`].length
