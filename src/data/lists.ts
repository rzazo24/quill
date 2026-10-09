// Reading the lists people publish: follows (kind 3), mutes (kind 10000), profiles (kind 0). Pure functions over events.
import type { Event } from 'nostr-tools'
import { cleanText } from '../core/text.js'

const HEX = /^[0-9a-f]{64}$/

/** For replaceable events: the newest one wins; on a tie the lowest id (NIP-01). */
export function newestPerAuthor(events: Event[]): Map<string, Event> {
  const best = new Map<string, Event>()
  for (const e of events) {
    const cur = best.get(e.pubkey)
    if (!cur || e.created_at > cur.created_at || (e.created_at === cur.created_at && e.id < cur.id)) best.set(e.pubkey, e)
  }
  return best
}

export function followsOf(event: Pick<Event, 'tags'>): string[] {
  return [...new Set(event.tags.filter((t) => t[0] === 'p' && HEX.test(t[1] ?? '')).map((t) => t[1]!))]
}

/** The public part of a mute list: keys and words. (The private part is encrypted and is not read.) */
export function mutesOf(event: Pick<Event, 'tags'>): { pubkeys: string[]; words: string[] } {
  const pubkeys = [...new Set(event.tags.filter((t) => t[0] === 'p' && HEX.test(t[1] ?? '')).map((t) => t[1]!))]
  const words = [...new Set(event.tags.filter((t) => t[0] === 'word' && (t[1] ?? '').trim()).map((t) => cleanText(t[1], 60).trim().toLowerCase()))]
  return { pubkeys, words }
}

/** A short display name from a profile, or undefined. Never throws: profiles are written by strangers. */
export function nameOf(event: Pick<Event, 'content'>): string | undefined {
  try {
    const p = JSON.parse(event.content) as Record<string, unknown>
    const raw = [p.display_name, p.displayName, p.name].find((v) => typeof v === 'string' && v.trim())
    const name = typeof raw === 'string' ? cleanText(raw, 40).replace(/\s+/g, ' ').trim() : ''
    return name || undefined
  } catch { return undefined }
}
