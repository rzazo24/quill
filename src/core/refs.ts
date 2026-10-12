// `nostr:npub1…` and `nostr:note1…` inside a note: found and decoded so the interface can show a name or a link instead of 60 characters.
import { normalizeRelay } from '../net/relays.js'
import { nip19 } from 'nostr-tools'

export type Part =
  | { type: 'text'; value: string }
  | { type: 'person'; value: string; pubkey: string }
  | { type: 'note'; value: string; id: string; /** where the reference says the note can be found (nevent), tidy secure addresses only */ relays?: string[] }
  /** a long-form article (NIP-23, kind 30023), named by its author and its `d` identifier (naddr); `naddr` is the bech32 string itself, for links */
  | { type: 'article'; value: string; naddr: string; pubkey: string; identifier: string; relays?: string[] }

const REF = /nostr:(npub1[a-z0-9]{58}|nprofile1[a-z0-9]+|note1[a-z0-9]{58}|nevent1[a-z0-9]+|naddr1[a-z0-9]+)/g
export const ARTICLE_KIND = 30023
const tidy = (relays: string[] | undefined): string[] => [...new Set((relays ?? []).map((r) => normalizeRelay(r)).filter((r): r is string => !!r))].slice(0, 3)

function decode(ref: string): Part | null {
  try {
    const d = nip19.decode(ref)
    if (d.type === 'npub') return { type: 'person', value: ref, pubkey: d.data }
    if (d.type === 'nprofile') return { type: 'person', value: ref, pubkey: d.data.pubkey }
    if (d.type === 'note') return { type: 'note', value: ref, id: d.data }
    if (d.type === 'nevent') { const hints = [...new Set((d.data.relays ?? []).map((r) => normalizeRelay(r)).filter((r): r is string => !!r))].slice(0, 3); return { type: 'note', value: ref, id: d.data.id, ...(hints.length ? { relays: hints } : {}) } }
    if (d.type === 'naddr' && d.data.kind === ARTICLE_KIND && /^[0-9a-f]{64}$/.test(d.data.pubkey)) { const hints = tidy(d.data.relays); return { type: 'article', value: ref, naddr: ref, pubkey: d.data.pubkey, identifier: d.data.identifier, ...(hints.length ? { relays: hints } : {}) } }
  } catch { /* a malformed reference stays plain text */ }
  return null
}

export function refs(text: string): Part[] {
  const out: Part[] = []
  let last = 0
  for (const m of text.matchAll(REF)) {
    const part = decode(m[1]!)
    if (!part) continue
    const at = m.index ?? 0
    if (at > last) out.push({ type: 'text', value: text.slice(last, at) })
    out.push(part)
    last = at + m[0].length
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) })
  return out
}

/** Every pubkey mentioned in a note, to look their names up in one go. */
export const mentionedKeys = (text: string): string[] => refs(text).flatMap((p) => (p.type === 'person' ? [p.pubkey] : []))

export const shortNpub = (pubkey: string): string => {
  const n = nip19.npubEncode(pubkey)
  return `${n.slice(0, 9)}…${n.slice(-4)}`
}
