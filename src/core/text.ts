// Text written by strangers, made safe to show. Pure functions: no DOM, no network.

// Control characters (except \n and \t) and the invisible characters used to disguise text or reorder it on screen: zero-width, bidi
// overrides/isolates, BOM, soft hyphen, Unicode "tag" characters. U+200D (zero-width joiner) and the emoji variation selectors stay,
// because family/flag emoji need them.
const INVISIBLE = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u00AD\\u061C\\u180E\\u200B\\u200C\\u200E\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u206F\\uFEFF\\uFFF9-\\uFFFB]|[\\u{E0000}-\\u{E007F}]',
  'gu',
)

/** Third-party text with hidden characters removed, line breaks tidied and a bounded length. */
export function cleanText(input: unknown, max: number): string {
  let s = typeof input === 'string' ? input : String(input ?? '')
  s = s.replace(INVISIBLE, '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n')
  const chars = [...s]
  return chars.length > max ? chars.slice(0, max).join('') + `… [+${chars.length - max} chars]` : s
}

export type Segment = { type: 'text'; value: string } | { type: 'link'; value: string; href: string }

const URL_RE = /https?:\/\/[^\s<>"']+/gi
const TRAILING = /[.,;:!?)\]}]+$/

/**
 * Splits a note into plain text and links. Only http(s) links are links, and the whole address is shown (nothing is shortened or
 * hidden behind a label), so a link cannot say one thing and go somewhere else. Nothing here loads anything.
 */
export function segments(text: string): Segment[] {
  const out: Segment[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0]
    const tail = TRAILING.exec(url)?.[0] ?? ''
    if (tail) url = url.slice(0, -tail.length)
    let href: string
    try { const u = new URL(url); if (u.protocol !== 'https:' && u.protocol !== 'http:') continue; href = u.href } catch { continue }
    const at = m.index ?? 0
    if (at > last) out.push({ type: 'text', value: text.slice(last, at) })
    out.push({ type: 'link', value: url, href })
    last = at + url.length
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) })
  return out
}

export const hasLink = (text: string): boolean => segments(text).some((s) => s.type === 'link')

/** A comparison form of a text: lower case, links and numbers collapsed, punctuation and emoji dropped, spaces squeezed. */
export function normalizeText(s: string): string {
  return cleanText(s, 5000)
    .toLowerCase()
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' <url> ')
    .replace(/\p{N}+/gu, '#')
    .replace(/[^\p{L}\p{M}#<>\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A text worth calling "copied" when several keys post it: a short greeting ("gm") is not; three or more words, or a link, is. */
export const isDistinctive = (normalized: string): boolean => normalized.split(' ').filter(Boolean).length >= 3 || normalized.includes('<url>')

/** The most events inside any `windowSeconds` span, and how long they actually took. */
export function burstOf(timestamps: number[], windowSeconds: number): { events: number; seconds: number } {
  const ts = [...timestamps].sort((a, b) => a - b)
  let best = 0, bestSpan = 0
  for (let i = 0, j = 0; i < ts.length; i++) {
    while (ts[i]! - ts[j]! > windowSeconds) j++
    if (i - j + 1 > best) { best = i - j + 1; bestSpan = ts[i]! - ts[j]! }
  }
  return { events: best, seconds: bestSpan }
}
