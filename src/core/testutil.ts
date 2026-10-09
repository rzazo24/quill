import type { Event } from 'nostr-tools'

let n = 0
/** A minimal event for tests (the filter never checks signatures; the network layer does). */
export function ev(pubkey: string, content: string, over: Partial<Event> = {}): Event {
  n++
  return { id: n.toString(16).padStart(64, '0'), pubkey, kind: 1, created_at: 1_700_000_000 + n, tags: [], content, sig: '0'.repeat(128), ...over }
}
export const pk = (c: string) => c.repeat(64).slice(0, 64)
