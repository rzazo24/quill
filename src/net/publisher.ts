// Sending a signed event to the relays and saying, relay by relay, what happened.
import type { Event } from 'nostr-tools'
import { SimplePool } from 'nostr-tools/pool'
import { cleanText } from '../core/text.js'
import { DEFAULT_RELAYS } from './fetcher.js'

/** "ok" when the relay accepted it; otherwise what it said, or why there was no answer. */
export type Outcome = string
export interface Publisher { publish(event: Event, relays?: string[]): Promise<Record<string, Outcome>> }

const NO_ANSWER = 'no answer from the relay'

/** A failure of the CONNECTION (a socket that died while the app was in the background, no answer) is worth one more try on a new connection. A relay that answered "no" with
 *  a reason (blocked, rate-limited, invalid...) will answer the same again: that is reported as it is. */
const connectionFailure = (message: string): boolean => message === NO_ANSWER || /connect|closed|socket|network|time(d)? ?out|econn|refused|reset|failed to fetch|offline/i.test(message)

export function poolPublisher(relays: string[] | (() => string[]) = DEFAULT_RELAYS, timeoutMs = 8000, pool = new SimplePool()): Publisher {
  /** One try at one relay: null when it accepted, otherwise why not. */
  const attempt = async (url: string, event: Event, ms: number): Promise<string | null> => {
    try {
      await Promise.race([pool.publish([url], event)[0]!, new Promise((_, reject) => setTimeout(() => reject(new Error(NO_ANSWER)), ms))])
      return null
    } catch (e) { return cleanText(e instanceof Error ? e.message : String(e), 120) || 'failed' }
  }
  return {
    async publish(event, only = typeof relays === 'function' ? relays() : relays) {
      const results = await Promise.all(only.map(async (url) => {
        let why = await attempt(url, event, timeoutMs)
        // On a phone the connections die while the app is in the background (for instance while the signer asks for approval): the first try fails, a new connection works
        if (why !== null && connectionFailure(why)) { try { pool.close([url]) } catch { /* it was not open */ } why = await attempt(url, event, Math.min(timeoutMs, 6000)) }
        return [url, why ?? 'ok'] as const
      }))
      return Object.fromEntries(results)
    },
  }
}

export const failedRelays = (r: Record<string, Outcome>): string[] => Object.entries(r).filter(([, o]) => o !== 'ok').map(([u]) => u)
