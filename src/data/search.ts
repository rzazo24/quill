// Search inside Quill: in what it has already loaded (the notes it showed, the names it knows), on the reader's device; and, only when asked,
// in two relays that can search text (NIP-50), which then see what was searched for.
import { nip19, type Event } from 'nostr-tools'
import { judgeAll, type Context, type Judged, type Settings } from '../core/verdict.js'
import type { Fetcher } from '../net/fetcher.js'

export const SEARCH_RELAYS = ['wss://search.nos.today', 'wss://relay.ditto.pub']
export const MIN_QUERY = 2

/** Lower case, without accents, spaces squeezed: "Ágora" finds "agora". */
export const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()

/** A pasted identifier opens what it names instead of searching. */
export type Target = { kind: 'user'; pubkey: string } | { kind: 'note'; id: string }
export function parseTarget(input: string): Target | null {
  const s = input.trim().replace(/^nostr:/i, '')
  if (!/^(npub|nprofile|note|nevent)1[02-9ac-hj-np-z]+$/i.test(s)) return null
  try {
    const d = nip19.decode(s)
    if (d.type === 'npub') return { kind: 'user', pubkey: d.data }
    if (d.type === 'nprofile') return { kind: 'user', pubkey: d.data.pubkey }
    if (d.type === 'note') return { kind: 'note', id: d.data }
    if (d.type === 'nevent') return { kind: 'note', id: d.data.id }
  } catch { /* not one */ }
  return null
}

/** Notes whose text has every word searched for ("#tag" also matches the note's `t` tags), newest first. */
export function matchNotes(notes: Iterable<Judged>, query: string, max = 50): Judged[] {
  const words = fold(query).split(' ').filter(Boolean)
  if (!words.length) return []
  const out: Judged[] = []
  for (const j of notes) {
    const text = fold(j.event.content), tags = j.event.tags.filter((t) => t[0] === 't').map((t) => '#' + fold(t[1] ?? ''))
    if (words.every((w) => text.includes(w) || (w.startsWith('#') && tags.includes(w)))) out.push(j)
  }
  return out.sort((a, b) => b.event.created_at - a.event.created_at).slice(0, max)
}

/** How an account is related to the reader, for ordering the people found and saying it. */
export type Relation = 'follow' | 'network' | 'none'
export interface Found { pubkey: string; name: string; relation: Relation }
const RANK: Record<Relation, number> = { follow: 0, network: 1, none: 2 }

/** Known names that have every word searched for ("@ana" works too), the reader's follows first, then their network. Muted accounts are left out. */
export function matchPeople(names: ReadonlyMap<string, string>, query: string, ctx: Context, max = 20): Found[] {
  const words = fold(query.replace(/^@/, '')).split(' ').filter(Boolean)
  if (!words.length) return []
  const out: Found[] = []
  for (const [pubkey, name] of names) {
    if (pubkey === ctx.me || ctx.muted.has(pubkey)) continue
    const n = fold(name)
    if (words.every((w) => n.includes(w))) out.push({ pubkey, name, relation: relationOf(pubkey, ctx) })
  }
  return sortPeople(out).slice(0, max)
}

export const relationOf = (pubkey: string, ctx: Context): Relation => (ctx.follows.has(pubkey) ? 'follow' : (ctx.graph.distance(pubkey) ?? 99) <= 2 ? 'network' : 'none')
export const sortPeople = (list: Found[]): Found[] => list.sort((a, b) => RANK[a.relation] - RANK[b.relation] || a.name.localeCompare(b.name))

/** Asks the search relays. Notes are judged like any other (the "outside your network" rule off: searching is reaching out); people come from their profiles. */
export async function searchNetwork(f: Fetcher, query: string, ctx: Context, settings: Settings): Promise<{ notes: Judged[]; people: Found[] }> {
  const [notes, profiles] = await Promise.all([f.query({ kinds: [1], search: query, limit: 40 } as never), f.query({ kinds: [0], search: query.replace(/^@/, ''), limit: 20 } as never)])
  const here: Settings = { ...settings, rules: { ...settings.rules, outsideNetwork: false } }
  const seen = new Set<string>()
  const judged = judgeAll(notes.filter((e) => e.kind === 1 && !seen.has(e.id) && seen.add(e.id)), ctx, here).sort((a, b) => b.event.created_at - a.event.created_at)
  const newest = new Map<string, Event>()
  for (const p of profiles) if (p.kind === 0 && (newest.get(p.pubkey)?.created_at ?? -1) < p.created_at) newest.set(p.pubkey, p)
  const people: Found[] = []
  for (const [pubkey, p] of newest) {
    if (pubkey === ctx.me || ctx.muted.has(pubkey)) continue
    let name = ''
    try { const m = JSON.parse(p.content) as { display_name?: unknown; name?: unknown }; name = String((typeof m.display_name === 'string' && m.display_name.trim()) || (typeof m.name === 'string' && m.name.trim()) || '') } catch { /* no name */ }
    if (name) people.push({ pubkey, name: name.slice(0, 60), relation: relationOf(pubkey, ctx) })
  }
  return { notes: judged, people: sortPeople(people) }
}
