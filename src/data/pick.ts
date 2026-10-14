// "DailyPick of the day": a short selection made every morning on Quill's server (by an AI that reads the candidates, from the network of the account
// that runs this Quill), the same for every reader. Read from the site as JSON; each entry names a note by its id, with a title and a summary in
// English and Spanish. The notes themselves come from the relays and are judged by the reader's own filter like any other.
import type { Event } from 'nostr-tools'
import type { Fetcher } from '../net/fetcher.js'

export interface PickItem { id: string; pubkey: string; title: string; summary: string }
export interface DailyPick { date: string; items: PickItem[] }
const HEX64 = /^[0-9a-f]{64}$/
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** The file as published, in the reader's language; null when it is missing or not what it should be. Entries that are not well formed are dropped. */
export function parsePick(raw: unknown, lang: 'en' | 'es'): DailyPick | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { date?: unknown; items?: unknown }
  if (typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !Array.isArray(r.items)) return null
  const items: PickItem[] = []
  for (const it of r.items.slice(0, 20) as Record<string, unknown>[]) {
    const words = (it?.[lang] ?? it?.es ?? it?.en) as Record<string, unknown> | undefined
    const id = typeof it?.id === 'string' ? it.id : '', pubkey = typeof it?.pubkey === 'string' ? it.pubkey : ''
    const title = text(words?.title, 120), summary = text(words?.summary, 600)
    if (HEX64.test(id) && HEX64.test(pubkey) && title) items.push({ id, pubkey, title, summary })
  }
  return items.length ? { date: r.date, items } : null
}

/** The notes of the selection, from the relays (only those by the author the file names). */
export async function loadPickNotes(f: Fetcher, items: PickItem[]): Promise<Map<string, Event>> {
  const out = new Map<string, Event>()
  if (!items.length) return out
  const by = new Map(items.map((i) => [i.id, i.pubkey]))
  for (const e of await f.query({ ids: items.map((i) => i.id), kinds: [1], limit: items.length })) if (by.get(e.id) === e.pubkey) out.set(e.id, e)
  return out
}
