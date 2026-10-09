// Who is reading: an npub, an nprofile or a 64-character hex key. Reading needs no private key, and one is refused on sight.
import { nip19 } from 'nostr-tools'

export type Identity = { ok: true; pubkey: string } | { ok: false; reason: 'bad' | 'secret' }

export function parseIdentity(input: string): Identity {
  const s = input.trim().replace(/^nostr:/i, '')
  if (/^nsec1/i.test(s)) return { ok: false, reason: 'secret' } // never keep it: not even to say "that's a private key" back
  if (/^[0-9a-f]{64}$/i.test(s)) return { ok: true, pubkey: s.toLowerCase() }
  try {
    const d = nip19.decode(s)
    if (d.type === 'npub') return { ok: true, pubkey: d.data }
    if (d.type === 'nprofile') return { ok: true, pubkey: d.data.pubkey }
  } catch { /* falls through */ }
  return { ok: false, reason: 'bad' }
}
