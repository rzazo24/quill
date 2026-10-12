import type { Event, Filter } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import { ev, pk } from '../core/testutil.js'
import { answers, type Fetcher, type QueryOptions } from '../net/fetcher.js'
import { fromOutbox, planOutbox, writeRelays } from './outbox.js'
import { loadFollowing } from './feed.js'
import { DEFAULT_SETTINGS } from '../core/verdict.js'
import { buildGraph } from './graph.js'
import { contextOf } from './session.js'

const me = pk('1'), a = pk('a'), b = pk('b'), c = pk('c'), d = pk('d')
const MINE = ['wss://relay.mine.example', 'wss://nos.lol']

/** Relays by address: the reader's ones answer queries without `only`; the others only when asked for by name. */
function world(byRelay: Record<string, Event[]>): Fetcher & { asked: { filter: Filter; only?: string[] }[] } {
  const asked: { filter: Filter; only?: string[] }[] = []
  return {
    asked,
    query: async (filter: Filter, o?: QueryOptions) => {
      asked.push({ filter, ...(o?.only ? { only: o.only } : {}) })
      const relays = o?.only ?? MINE
      const seen = new Set<string>()
      return relays.flatMap((r) => byRelay[r] ?? []).filter((e) => answers(filter, e) && !seen.has(e.id) && seen.add(e.id))
    },
  }
}
const relayList = (owner: string, tags: string[][]) => ev(owner, '', { kind: 10002, tags, created_at: 500 })

describe('reading people where they write (NIP-65 outbox)', () => {
  it('write relays: marked "write" or unmarked; "read" and invalid addresses are left out', () => {
    expect(writeRelays(relayList(a, [['r', 'wss://w.example'], ['r', 'wss://both.example/'], ['r', 'wss://r.example', 'read'], ['r', 'wss://x.example', 'write'], ['r', 'ws://plain.example'], ['r', 'wss://1.2.3.4']])))
      .toEqual(['wss://w.example', 'wss://both.example', 'wss://x.example'])
  })
  it('the plan covers only people with none of the reader\'s relays, picks the relays that cover most, and caps relays and relays per person', () => {
    const lists = new Map([[a, ['wss://nos.lol', 'wss://far.example']], [b, ['wss://far.example', 'wss://x.example']], [c, ['wss://far.example', 'wss://y.example', 'wss://z.example']], [d, ['wss://y.example']]])
    const plan = planOutbox(lists, MINE)
    expect(plan.get('wss://far.example')).toEqual([b, c]) // a writes on nos.lol, one of the reader's: not needed
    expect([...plan.values()].flat().filter((x) => x === c)).toHaveLength(2) // c on two relays at most
    expect(planOutbox(lists, MINE, { maxRelays: 1 }).size).toBe(1)
    expect(planOutbox(new Map([[a, []]]), MINE).size).toBe(0) // no list, nothing to plan
  })
  it('the feed gets the notes of someone who writes only elsewhere, asking that relay only for them', async () => {
    const elsewhere = ev(b, 'written on my own relay', { created_at: 900 })
    const w = world({
      'wss://relay.mine.example': [ev(a, 'on the reader relay', { created_at: 800 }), relayList(a, [['r', 'wss://nos.lol']]), relayList(b, [['r', 'wss://far.example']])],
      'wss://far.example': [elsewhere, ev(c, 'someone not followed', { created_at: 950 })],
    })
    const ctx = contextOf({ me, follows: new Set([a, b]), muted: new Set(), mutedWords: [], graphInfo: buildGraph(me, new Set([a, b]), new Map()) })
    const without = await loadFollowing(w, ctx, DEFAULT_SETTINGS)
    expect(without.map((j) => j.event.content)).not.toContain('written on my own relay')
    const withIt = await loadFollowing(w, ctx, DEFAULT_SETTINGS, { outbox: MINE })
    expect(withIt.map((j) => j.event.content)).toContain('written on my own relay')
    const far = w.asked.filter((q) => q.only)
    expect(far).toHaveLength(1); expect(far[0]!.only).toEqual(['wss://far.example']); expect(far[0]!.filter.authors).toEqual([b])
  })
  it('a relay that fails adds nothing and breaks nothing', async () => {
    const f: Fetcher = { query: async (_f, o) => { if (o?.only) throw new Error('down'); return [relayList(b, [['r', 'wss://far.example']])] } }
    expect(await fromOutbox(f, { kinds: [1] }, [b], MINE)).toEqual([])
  })
})

describe('remembered answers', () => {
  it('asking someone\'s own relay is not the same question as asking the reader\'s', async () => {
    const { memo } = await import('../net/fetcher.js')
    let n = 0
    const m = memo({ query: async () => { n++; return [] } })
    await m.query({ kinds: [1], authors: [b] }); await m.query({ kinds: [1], authors: [b] }, { only: ['wss://far.example'] }); await m.query({ kinds: [1], authors: [b] }, { only: ['wss://far.example'] })
    expect(n).toBe(2)
  })
})
