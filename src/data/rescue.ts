// "Your notes, safe": where each of the reader's notes is, a copy of the thin ones to the reader's relays, and a file with everything they published.
// Nothing here signs anything: the notes already carry the reader's signature, so any relay can take them as they are, and nobody can change them.
import type { Event, Filter } from 'nostr-tools'
import type { Fetcher } from '../net/fetcher.js'
import type { Publisher } from '../net/publisher.js'
import { ARTICLE_KIND } from '../core/refs.js'
import { COMMENT_KIND } from '../core/thread.js'

/** What is checked and copied: notes, replies, comments and articles. */
export const NOTE_KINDS = [1, COMMENT_KIND, ARTICLE_KIND]
/** What the file keeps besides: the profile, the follow list, deletions, reposts, the mute and relay lists, the DM relays. */
export const BACKUP_KINDS = [0, 1, 3, 5, 6, 16, COMMENT_KIND, 10000, 10002, 10050, ARTICLE_KIND]
const PAGE = 500, MAX_PAGES = 10 // relays answer a few hundred at a time: up to 5000 per relay, asked in pages going back in time

export interface RelayScan { relay: string; count: number; failed: boolean }
export interface Scan { notes: Map<string, Event>; where: Map<string, Set<string>>; perRelay: RelayScan[] }
export interface Coverage { total: number; single: number; missing: number; /** for each of the reader's relays, the notes it lacks */ lacking: Map<string, Event[]> }

/** Everything this relay holds of the author's that answers `kinds`, page by page (newest first, then `until` the oldest seen). */
export async function allFrom(f: Fetcher, relay: string, author: string, kinds: number[]): Promise<Event[]> {
  const out = new Map<string, Event>()
  let until: number | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const filter: Filter = { kinds, authors: [author], limit: PAGE, ...(until !== undefined ? { until } : {}) }
    const got = (await f.query(filter, { only: [relay], quick: false })).filter((e) => e.pubkey === author && kinds.includes(e.kind))
    let fresh = 0
    for (const e of got) if (!out.has(e.id)) { out.set(e.id, e); fresh++ }
    if (!fresh || got.length < PAGE / 2) break // a relay may cap below the limit asked: only stop when a page brings little or nothing new
    until = Math.min(...got.map((e) => e.created_at))
  }
  return [...out.values()]
}

/** Asks every relay, one by one in parallel, for the reader's notes; says what each holds. A relay that fails counts as holding nothing. */
export async function scanNotes(f: Fetcher, me: string, relays: string[], onRelay?: (done: number) => void): Promise<Scan> {
  const notes = new Map<string, Event>(), where = new Map<string, Set<string>>()
  let done = 0
  const deleted = new Set<string>() // a note the reader deleted (kind 5) that some relay still keeps is never counted, nor copied back
  const found = await Promise.all(relays.map(async (relay) => {
    try {
      const got = await allFrom(f, relay, me, [...NOTE_KINDS, 5])
      for (const e of got) if (e.kind === 5) for (const t of e.tags) if (t[0] === 'e' && t[1]) deleted.add(t[1])
      return { relay, got: got.filter((e) => e.kind !== 5), failed: false }
    } catch { return { relay, got: [] as Event[], failed: true } } finally { onRelay?.(++done) }
  }))
  const perRelay = found.map(({ relay, got, failed }): RelayScan => {
    const kept = got.filter((e) => !deleted.has(e.id))
    for (const e of kept) { notes.set(e.id, e); const s = where.get(e.id) ?? new Set<string>(); s.add(relay); where.set(e.id, s) }
    return { relay, count: kept.length, failed }
  })
  return { notes, where, perRelay }
}

/** Pure: how well spread the notes are. `single`: on one relay only; `missing`: absent from at least one of the reader's relays that answered. */
export function coverage(scan: Scan, mine: string[]): Coverage {
  const answered = mine.filter((r) => scan.perRelay.some((p) => p.relay === r && !p.failed))
  const lacking = new Map<string, Event[]>(answered.map((r) => [r, []]))
  let single = 0, missing = 0
  for (const [id, e] of scan.notes) {
    const at = scan.where.get(id) ?? new Set<string>()
    if (at.size <= 1) single++
    let lacks = false
    for (const r of answered) if (!at.has(r)) { lacking.get(r)!.push(e); lacks = true }
    if (lacks) missing++
  }
  for (const list of lacking.values()) list.sort((a, b) => a.created_at - b.created_at)
  return { total: scan.notes.size, single, missing, lacking }
}

export interface CopyResult { relay: string; sent: number; ok: number; failed: number; reason?: string }
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Sends each relay the notes it lacks, newest first, a few per second. A relay that says "too fast" is given more time between notes (doubling,
 *  up to MAX_GAP) and the same note again after a longer pause; that never counts as a refusal. A relay may refuse some notes and take others
 *  (old ones, for instance), so it is only left alone after GIVE_UP refusals in a row. */
const GIVE_UP = 10, MAX_GAP = 4000, RETRIES = 4
const slowDown = (why: string) => /rate|limit|slow|too (many|fast)|try again/i.test(why)
export async function copyNotes(p: Publisher, lacking: Map<string, Event[]>, onProgress?: (done: number, total: number) => void, gapMs = 250): Promise<CopyResult[]> {
  const total = [...lacking.values()].reduce((n, l) => n + l.length, 0)
  let done = 0
  return Promise.all([...lacking].filter(([, list]) => list.length).map(async ([relay, list]): Promise<CopyResult> => {
    const r: CopyResult = { relay, sent: 0, ok: 0, failed: 0 }
    let inARow = 0, gap = gapMs
    for (const e of [...list].sort((a, b) => b.created_at - a.created_at)) {
      let outcome = (await p.publish(e, [relay]))[relay] ?? 'no answer from the relay'
      for (let i = 0; i < RETRIES && outcome !== 'ok' && slowDown(outcome); i++) {
        gap = Math.min(MAX_GAP, Math.max(gap * 2, gapMs ? 500 : 0))
        await pause(gap * 2 ** (i + 1))
        outcome = (await p.publish(e, [relay]))[relay] ?? 'no answer from the relay'
      }
      r.sent++; done++; onProgress?.(done, total)
      if (outcome === 'ok' || /duplicate|already have/i.test(outcome)) { r.ok++; inARow = 0 } else { r.failed++; r.reason = outcome; if (++inARow >= GIVE_UP) { done += list.length - r.sent; onProgress?.(done, total); break } }
      if (gap) await pause(gap)
    }
    return r
  }))
}

/** Everything the reader published that the file keeps, from every relay, newest version of each replaceable list only, deleted notes left out. */
export async function collectBackup(f: Fetcher, me: string, relays: string[]): Promise<Event[]> {
  const all = new Map<string, Event>()
  const groups = [0, 5, 10].map((i) => BACKUP_KINDS.slice(i, i + 5)).filter((g) => g.length) // relays refuse long lists of kinds (khatru's sqlite store: more than 10 fails the whole question)
  await Promise.all(relays.flatMap((r) => groups.map(async (kinds) => { try { for (const e of await allFrom(f, r, me, kinds)) all.set(e.id, e) } catch { /* that relay adds nothing */ } })))
  const deleted = new Set([...all.values()].filter((e) => e.kind === 5).flatMap((e) => e.tags.filter((t) => t[0] === 'e').map((t) => t[1])))
  const newest = new Map<string, Event>() // replaceable (0, 3, 1xxxx) and addressable (3xxxx by d tag): only the newest counts
  const keep: Event[] = []
  for (const e of all.values()) {
    if (deleted.has(e.id)) continue
    const replaceable = e.kind === 0 || e.kind === 3 || (e.kind >= 10000 && e.kind < 20000)
    const addressable = e.kind >= 30000 && e.kind < 40000
    if (!replaceable && !addressable) { keep.push(e); continue }
    const key = `${e.kind}:${addressable ? e.tags.find((t) => t[0] === 'd')?.[1] ?? '' : ''}`
    const o = newest.get(key)
    if (!o || e.created_at > o.created_at || (e.created_at === o.created_at && e.id < o.id)) newest.set(key, e)
  }
  return [...keep, ...newest.values()].sort((a, b) => b.created_at - a.created_at)
}

/**
 * Reads a backup file back (the one `backupFile` writes, or a plain JSON list of events): only events validly signed by `me` are kept, once each, so
 * a file cannot be used to publish anyone else's notes through this reader's relays. `skipped` counts what was left out.
 */
export function readBackup(text: string, me: string, verify: (e: Event) => boolean): { events: Event[]; skipped: number } {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return { events: [], skipped: 0 } }
  const list: unknown[] = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { events?: unknown }).events) ? (raw as { events: unknown[] }).events : []
  const seen = new Set<string>(), events: Event[] = []
  let skipped = 0
  for (const x of list) {
    const e = x as Event
    const shaped = !!e && typeof e === 'object' && typeof e.id === 'string' && typeof e.sig === 'string' && typeof e.kind === 'number' && typeof e.content === 'string' && Array.isArray(e.tags) && typeof e.created_at === 'number'
    if (!shaped || e.pubkey !== me || seen.has(e.id)) { skipped++; continue }
    let ok = false
    try { ok = verify({ ...e }) } catch { ok = false }
    if (!ok) { skipped++; continue }
    seen.add(e.id); events.push(e)
  }
  return { events: events.sort((a, b) => b.created_at - a.created_at), skipped }
}

/** The file: plain JSON any Nostr tool can read back (one signed event per entry), with a short header. */
export function backupFile(me: string, events: Event[], nowMs: number): { name: string; text: string } {
  const day = new Date(nowMs).toISOString().slice(0, 10)
  return { name: `nostr-backup-${me.slice(0, 8)}-${day}.json`, text: JSON.stringify({ about: 'Signed Nostr events, as published. Any relay accepts them again unchanged.', pubkey: me, saved: new Date(nowMs).toISOString(), events }, null, 1) }
}
