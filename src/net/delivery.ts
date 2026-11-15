// Making sure what the reader published really is on their relays. A relay's "ok" is not proof (some keep a note they never answered for, others
// answer "ok" and drop it later), and a refusal is often temporary (rate limits, an overloaded relay, a phone that lost the connection). So every
// event Quill publishes is checked a little later, relay by relay, by asking for it by id; a relay that does not have it gets the same signed event
// again, with growing pauses, for up to a day. Nothing is signed again. The list lives on this device only.
import type { Event } from 'nostr-tools'
import type { Fetcher } from './fetcher.js'
import type { Publisher } from './publisher.js'
import { safeGet, safeSet, type KV } from '../ui/store.js'

export interface Pending { event: Event; relays: string[]; tries: number; next: number; first: number }
export interface TickReport { confirmed: number; resent: number; gaveUp: number }

const KEY = 'deliveries'
/** When to look again: the first look 20 s after publishing, then the pauses between resends. */
export const DELAYS = [20_000, 2 * 60_000, 10 * 60_000, 60 * 60_000, 6 * 60 * 60_000]
const MAX_AGE = 24 * 60 * 60_000
const MAX_ITEMS = 30

export class Delivery {
  private busy = false
  constructor(private readonly d: { publisher: Publisher; fetcher: Fetcher; kv?: KV; now?: () => number }) {}
  private now(): number { return this.d.now?.() ?? Date.now() }

  pending(): Pending[] {
    try {
      const v = JSON.parse(safeGet(this.d.kv, KEY) ?? '[]') as unknown
      return Array.isArray(v) ? v.filter((p): p is Pending => !!p && typeof p === 'object' && !!(p as Pending).event?.id && Array.isArray((p as Pending).relays)) : []
    } catch { return [] }
  }
  private save(list: Pending[]): void { safeSet(this.d.kv, KEY, list.length ? JSON.stringify(list.slice(-MAX_ITEMS)) : null) }

  /** Just published: look at every relay it went to (the ones that said "ok" too) in a moment. */
  track(event: Event, outcomes: Record<string, string>): void {
    const relays = Object.keys(outcomes)
    if (!relays.length) return
    const now = this.now()
    this.save([...this.pending().filter((p) => p.event.id !== event.id), { event, relays, tries: 0, next: now + DELAYS[0]!, first: now }])
  }

  /** Does this relay have it? Asked of that relay alone. A relay that does not answer counts as "not yet". */
  private async has(relay: string, id: string): Promise<boolean> {
    try { return (await this.d.fetcher.query({ ids: [id] }, { only: [relay], quick: false })).some((e) => e.id === id) } catch { return false }
  }

  /** Looks at what is due: drops the relays that have it, sends it again to the rest, and gives up after a day or the last pause. */
  async tick(): Promise<TickReport> {
    const report: TickReport = { confirmed: 0, resent: 0, gaveUp: 0 }
    if (this.busy) return report
    this.busy = true
    try {
      const now = this.now(), keep: Pending[] = []
      for (const p of this.pending()) {
        if (p.next > now) { keep.push(p); continue }
        const held = await Promise.all(p.relays.map((r) => this.has(r, p.event.id)))
        const missing = p.relays.filter((_, i) => !held[i])
        report.confirmed += p.relays.length - missing.length
        if (!missing.length) continue
        const tries = p.tries + 1
        if (tries >= DELAYS.length || now - p.first > MAX_AGE) { report.gaveUp += missing.length; continue }
        await this.d.publisher.publish(p.event, missing).catch(() => undefined)
        report.resent += missing.length
        // even an "ok" is checked again at the next look
        keep.push({ ...p, relays: missing, tries, next: now + DELAYS[tries]! })
      }
      // anything tracked while this ran stays
      const ids = new Set(keep.map((p) => p.event.id))
      const latest = this.pending().filter((p) => p.first >= now && p.tries === 0 && !ids.has(p.event.id))
      this.save([...keep, ...latest])
    } finally { this.busy = false }
    return report
  }
}
