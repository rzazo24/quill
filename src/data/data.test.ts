import type { Event, Filter } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import { ev, pk } from '../core/testutil.js'
import { answers, accept, queryAuthors, type Fetcher } from '../net/fetcher.js'
import { loadFollowing, loadMentions, loadNames, loadThread, buildTree } from './feed.js'
import { buildGraph } from './graph.js'
import { followsOf, mutesOf, nameOf, newestPerAuthor } from './lists.js'
import { contextOf, loadSession } from './session.js'
import { judgeAll } from '../core/verdict.js'

const me = pk('1'), a = pk('a'), b = pk('b'), c = pk('c'), far = pk('f')

/** A fake relay set: answers filters the way a relay would, from a list of events. */
function fake(events: Event[]): Fetcher & { calls: Filter[] } {
  const calls: Filter[] = []
  return { calls, query: async (filter) => { calls.push(filter); return events.filter((e) => answers(filter, e)).slice(0, filter.limit ?? 1000) } }
}
const list = (owner: string, kind: number, tags: string[][], at = 1000) => ev(owner, '', { kind, tags, created_at: at })

describe('fetcher: a relay is a stranger', () => {
  const e1 = ev(a, 'one'), e2 = ev(b, 'two', { kind: 7 })
  it('drops events that do not answer the filter, duplicates and bad signatures', () => {
    const f: Filter = { kinds: [1], authors: [a] }
    expect(answers(f, e1)).toBe(true)
    expect(answers(f, e2)).toBe(false)
    expect(accept(f, [e1, e1, e2], () => true)).toEqual([e1])
    expect(accept(f, [e1], () => false)).toEqual([])
  })
  it('checks tag filters and ids', () => {
    const t = ev(a, 'x', { tags: [['e', 'z'.repeat(64)], ['p', me]] })
    expect(answers({ '#e': ['z'.repeat(64)] }, t)).toBe(true)
    expect(answers({ '#e': ['y'.repeat(64)] }, t)).toBe(false)
    expect(answers({ '#p': [me], ids: [t.id] }, t)).toBe(true)
    expect(answers({ ids: ['0'.repeat(64)] }, t)).toBe(false)
  })
  it('queries many authors in chunks and merges', async () => {
    const authors = Array.from({ length: 250 }, (_, i) => i.toString(16).padStart(64, '0'))
    const f = fake([ev(a, 'x')])
    await queryAuthors(f, { kinds: [1] }, authors, 100)
    expect(f.calls.map((c) => c.authors!.length)).toEqual([100, 100, 50])
  })
})

describe('lists', () => {
  it('newest replaceable event wins; a tie goes to the lowest id', () => {
    const old = list(a, 3, [['p', b]], 100), neu = list(a, 3, [['p', c]], 200)
    expect(newestPerAuthor([old, neu]).get(a)).toBe(neu)
    const t1 = ev(a, '', { kind: 3, created_at: 5, id: '1'.repeat(64) }), t2 = ev(a, '', { kind: 3, created_at: 5, id: '2'.repeat(64) })
    expect(newestPerAuthor([t2, t1]).get(a)).toBe(t1)
  })
  it('reads follows and mutes, ignoring malformed tags', () => {
    expect(followsOf({ tags: [['p', a], ['p', a], ['p', 'nothex'], ['e', b]] })).toEqual([a])
    expect(mutesOf({ tags: [['p', b], ['word', ' Giveaway '], ['word', ''], ['t', 'x']] })).toEqual({ pubkeys: [b], words: ['giveaway'] })
  })
  it('profile names are cleaned, bounded, and never throw', () => {
    expect(nameOf({ content: JSON.stringify({ display_name: ' Ana‮  Díaz ', name: 'ana' }) })).toBe('Ana Díaz')
    expect(nameOf({ content: JSON.stringify({ name: 'x'.repeat(100) }) })!.length).toBeLessThan(60)
    expect(nameOf({ content: 'not json' })).toBeUndefined()
    expect(nameOf({ content: JSON.stringify({ name: 42 }) })).toBeUndefined()
  })
})

describe('graph', () => {
  const follows = new Set([a, b])
  it('distances: you 0, your follows 1, their follows 2, others unknown', () => {
    const { graph } = buildGraph(me, follows, new Map([[a, [c]], [b, []]]))
    expect([me, a, c, far].map((k) => graph.distance(k))).toEqual([0, 1, 2, null])
    expect(graph.loaded).toBe(true)
  })
  it('is NOT loaded when fewer than half of the lists arrived: missing lists must not make everyone look like a stranger', () => {
    expect(buildGraph(me, new Set([a, b, c]), new Map([[a, [far]]])).graph.loaded).toBe(false)
    expect(buildGraph(me, new Set(), new Map()).graph.loaded).toBe(false)
  })
  it('ignores lists from people you do not follow', () => {
    const { graph, answered } = buildGraph(me, follows, new Map([[far, [c]], [a, []]]))
    expect(graph.distance(c)).toBeNull(); expect(answered).toBe(1)
  })
})

describe('session', () => {
  const world = [list(me, 3, [['p', a], ['p', b]]), list(me, 10000, [['p', far], ['word', 'giveaway']]), list(a, 3, [['p', c]]), list(b, 3, [['p', me]])]
  it('loads follows, mutes and a loaded graph', async () => {
    const s = await loadSession(fake(world), me)
    expect([...s.follows].sort()).toEqual([a, b])
    expect([...s.muted]).toEqual([far]); expect(s.mutedWords).toEqual(['giveaway'])
    expect(s.graphInfo.graph.loaded).toBe(true)
    expect(s.graphInfo.graph.distance(c)).toBe(2)
  })
  it('a reader who follows nobody has no graph, so nothing is "outside the network"', async () => {
    const s = await loadSession(fake([]), me)
    expect(s.graphInfo.graph.loaded).toBe(false)
  })
  it('local mutes are added to the reader\'s own', async () => {
    const ctx = contextOf(await loadSession(fake(world), me), { mutedWords: ['spam'], mutedKeys: [c] })
    expect([...ctx.mutedWords].sort()).toEqual(['giveaway', 'spam']); expect(ctx.muted.has(c) && ctx.muted.has(far)).toBe(true)
  })
})

describe('views', () => {
  const world = [list(me, 3, [['p', a]]), list(a, 3, [['p', c]])]
  const notes = [ev(a, 'a root note from a friend'), ev(a, 'a reply', { tags: [['e', 'e'.repeat(64), '', 'root']] }), ev(me, 'my own note here')]
  it('the following feed shows root notes only, newest first, all of them "followed" or "own"', async () => {
    const f = fake([...world, ...notes])
    const ctx = contextOf(await loadSession(f, me))
    const j = await loadFollowing(f, ctx)
    expect(j.map((x) => x.event.content).sort()).toEqual(['a root note from a friend', 'my own note here'])
    expect(j.every((x) => !x.verdict.hidden)).toBe(true)
  })
  it('mentions: strangers outside the network are folded, with the rule that did it', async () => {
    const mention = (who: string, text: string) => ev(who, text, { tags: [['p', me]] })
    const f = fake([...world, mention(a, 'hi from a friend'), mention(c, 'friend of a friend here'), mention(far, 'a stranger with a pitch')])
    const ctx = contextOf(await loadSession(f, me))
    const j = await loadMentions(f, ctx)
    const by = Object.fromEntries(j.map((x) => [x.event.pubkey, x.verdict]))
    expect(by[a]).toMatchObject({ hidden: false, rule: 'followed' })
    expect(by[c]).toMatchObject({ hidden: false, rule: 'default' })
    expect(by[far]).toMatchObject({ hidden: true, rule: 'outside-network' })
  })
  it('a thread: finds the root from a reply, builds the tree, orphans hang from the root', async () => {
    const root = ev(a, 'the root of it all')
    const r1 = ev(c, 'first reply', { tags: [['e', root.id, '', 'root'], ['e', root.id, '', 'reply']], created_at: 2000 })
    const r2 = ev(a, 'reply to the reply', { tags: [['e', root.id, '', 'root'], ['e', r1.id, '', 'reply']], created_at: 3000 })
    const orphan = ev(b, 'parent is missing', { tags: [['e', root.id, '', 'root'], ['e', 'd'.repeat(64), '', 'reply']], created_at: 4000 })
    const f = fake([...world, root, r1, r2, orphan])
    const ctx = contextOf(await loadSession(f, me))
    const t = (await loadThread(f, r2.id, ctx))!
    expect(t.rootId).toBe(root.id); expect(t.root!.event.id).toBe(root.id); expect(t.total).toBe(3)
    expect(t.replies.map((n) => n.item.event.id)).toEqual([r1.id, orphan.id])
    expect(t.replies[0]!.children.map((n) => n.item.event.id)).toEqual([r2.id])
    expect(await loadThread(f, 'e'.repeat(64), ctx)).toBeNull()
  })
  it('replies that answer each other in a loop cannot break the tree, and none is lost', () => {
    const x = ev(a, 'x'), y = ev(b, 'y', { tags: [['e', x.id, '', 'reply']] })
    const x2 = { ...x, tags: [['e', y.id, '', 'reply']] } as Event // x answers y while y answers x
    const ctx = contextOf({ me, follows: new Set(), muted: new Set(), mutedWords: [], graphInfo: buildGraph(me, new Set(), new Map()) })
    const tree = buildTree(pk('9'), judgeAll([x2, y], ctx))
    expect(tree.map((n) => n.item.event.id).sort()).toEqual([x.id, y.id].sort())
    const self = ev(a, 'self', { tags: [] }); const selfRef = { ...self, tags: [['e', self.id, '', 'reply']] } as Event
    expect(buildTree(pk('9'), judgeAll([selfRef], ctx)).length).toBe(1)
  })
  it('names: newest profile per key', async () => {
    const f = fake([ev(a, JSON.stringify({ name: 'old' }), { kind: 0, created_at: 1 }), ev(a, JSON.stringify({ name: 'new' }), { kind: 0, created_at: 2 }), ev(b, 'broken', { kind: 0 })])
    expect(await loadNames(f, [a, b])).toEqual(new Map([[a, 'new']]))
  })
})
