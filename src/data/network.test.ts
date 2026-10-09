import { describe, expect, it } from 'vitest'
import { ev, pk } from '../core/testutil.js'
import { contextOf, type Session } from './session.js'
import { buildGraph } from './graph.js'
import { loadNetwork, MAX_NETWORK_AUTHORS, networkCandidates } from './network.js'
import { answers, type Fetcher } from '../net/fetcher.js'

const me = pk('1'), ana = pk('a'), bob = pk('b'), cy = pk('c'), x = pk('d'), y = pk('e'), z = pk('f'), muted = pk('9')
const session = (lists: Record<string, string[]>, over: Partial<Session> = {}): Session => {
  const follows = new Set([ana, bob, cy])
  return { me, follows, muted: new Set(), mutedWords: [], graphInfo: buildGraph(me, follows, new Map(Object.entries(lists))), ...over }
}
const world = (events: ReturnType<typeof ev>[]): Fetcher => ({ query: async (f) => events.filter((e) => answers(f, e)).slice(0, f.limit ?? 1000) })

const sorted = (c: { author: string; via: string[] }[]) => c.map((x) => ({ ...x, via: [...x.via].sort() }))

describe('networkCandidates', () => {
  it('are the accounts your follows follow (not you, not yours, not muted), the most followed among your follows first, each with who follows them', () => {
    const s = session({ [ana]: [x, y, me, bob, muted], [bob]: [x, z], [cy]: [x, y] }, { muted: new Set([muted]) })
    expect(sorted(networkCandidates(s))).toEqual([{ author: x, via: [ana, bob, cy] }, { author: y, via: [ana, cy] }, { author: z, via: [bob] }])
  })
  it('ignores lists of people you do not follow, junk entries and repeats, breaks ties by key, and is capped', () => {
    const s = session({ [ana]: [x, x, 'not-a-key', x], [pk('8')]: [y] })
    expect(sorted(networkCandidates(s))).toEqual([{ author: x, via: [ana] }])
    const many = Array.from({ length: 500 }, (_, i) => i.toString(16).padStart(64, '0'))
    expect(networkCandidates(session({ [ana]: many }))).toHaveLength(MAX_NETWORK_AUTHORS)
    expect(networkCandidates(session({ [ana]: [z, x, y] })).map((c) => c.author)).toEqual([x, y, z])
  })
  it('the name that comes first varies between accounts but is the same every time', () => {
    const owners = Array.from({ length: 12 }, (_, i) => (((i + 1) * 0x9e3779b1) >>> 0).toString(16).padStart(8, '0').repeat(8)); const follows = new Set(owners)
    const s = { me, follows, muted: new Set<string>(), graphInfo: buildGraph(me, follows, new Map(owners.map((o) => [o, [x, y, z]]))) }
    const first = (a: string) => networkCandidates(s).find((c) => c.author === a)!.via[0]
    expect(new Set([x, y, z].map(first)).size).toBeGreaterThan(1); expect(networkCandidates(s)).toEqual(networkCandidates(s))
  })
  it('nothing when no list arrived', () => { expect(networkCandidates(session({}))).toEqual([]) })
})

describe('loadNetwork', () => {
  const lists = { [ana]: [x, y], [bob]: [x] }
  it('is the root notes of those accounts, newest first, each with who follows the author; replies and notes of anybody else are left out', async () => {
    const s = session(lists), reply = ev(x, 'a reply', { created_at: 1_800_000_050, tags: [['e', 'e'.repeat(64), '', 'reply']] })
    const f = world([ev(x, 'older note by x', { created_at: 1_800_000_010 }), ev(y, 'newer note by y', { created_at: 1_800_000_020 }), reply, ev(z, 'z is not in the network', { created_at: 1_800_000_030 })])
    const out = await loadNetwork(f, s, contextOf(s))
    expect(out.map((j) => j.event.content)).toEqual(['newer note by y', 'older note by x']); expect(out.map((j) => [...j.followedBy!].sort())).toEqual([[ana], [ana, bob]])
  })
  it('does not apply "outside your network" here (it would hide the whole view) but applies the other rules, and muted words', async () => {
    const s = session(lists, { mutedWords: ['spamword'] }), ctx = contextOf(s)
    const strict = { rules: { repeatedText: true, burst: true, linkOnly: true, outsideNetwork: true }, maxDistance: 1, burstEvents: 5 }
    const f = world([ev(x, 'a note from far away', { created_at: 1_800_000_010 }), ev(y, 'has spamword inside', { created_at: 1_800_000_020 })])
    const out = await loadNetwork(f, s, ctx, strict)
    expect(out.find((j) => j.event.content.startsWith('a note'))!.verdict.hidden).toBe(false); expect(out.find((j) => j.event.content.includes('spamword'))!.verdict).toMatchObject({ hidden: true, rule: 'muted-word' })
    const burst = Array.from({ length: 6 }, (_, i) => ev(x, `burst note number ${i}`, { created_at: 1_800_000_100 + i })); const b = await loadNetwork(world(burst), s, ctx)
    expect(b.some((j) => j.verdict.hidden && j.verdict.rule === 'burst')).toBe(true)
  })
  it('a relay that returns notes of other authors cannot put them in the view; no candidates means no query at all', async () => {
    const s = session(lists); const hostile: Fetcher = { query: async () => [ev(z, 'sneaked in', { created_at: 1_800_000_010 }), ev(x, 'legit', { created_at: 1_800_000_011 })] }
    expect((await loadNetwork(hostile, s, contextOf(s))).map((j) => j.event.content)).toEqual(['legit'])
    let asked = 0; const spy: Fetcher = { query: async () => { asked++; return [] } }; const empty = session({}); expect(await loadNetwork(spy, empty, contextOf(empty))).toEqual([]); expect(asked).toBe(0)
  })
})
