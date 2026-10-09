// Sending a signed event to the relays and saying, relay by relay, what happened.
import type { Event } from 'nostr-tools'
import { SimplePool } from 'nostr-tools/pool'
import { cleanText } from '../core/text.js'
import { DEFAULT_RELAYS } from './fetcher.js'

/** "ok" when the relay accepted it; otherwise what it said, or why there was no answer. */
export type Outcome = string
export interface Publisher { publish(event: Event, relays?: string[]): Promise<Record<string, Outcome>> }

const NO_ANSWER = 'no answer from the relay'

export function poolPublisher(relays: string[] | (() => string[]) = DEFAULT_RELAYS, timeoutMs = 8000, pool = new SimplePool()): Publisher {
  return {
    async publish(event, only = typeof relays === 'function' ? relays() : relays) {
      const results = await Promise.all(only.map(async (url) => {
        try {
          await Promise.race([
            pool.publish([url], event)[0]!,
            new Promise((_, reject) => setTimeout(() => reject(new Error(NO_ANSWER)), timeoutMs)),
          ])
          return [url, 'ok'] as const
        } catch (e) { return [url, cleanText(e instanceof Error ? e.message : String(e), 120) || 'failed'] as const }
      }))
      return Object.fromEntries(results)
    },
  }
}

export const failedRelays = (r: Record<string, Outcome>): string[] => Object.entries(r).filter(([, o]) => o !== 'ok').map(([u]) => u)
