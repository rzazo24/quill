import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import { ev, pk } from '../core/testutil.js'
import { contextOf } from './session.js'
import { buildGraph } from './graph.js'
import { loadFollowing } from './feed.js'
import { answers, type Fetcher } from '../net/fetcher.js'
import { fetchOriginals, mergeFeed, repostRefs } from './reposts.js'

const me = pk('1'), ana = pk('a'), bob = pk('b'), stranger = pk('f')
const yes = () => true
const repost = (who: string, target: Event, at: number, over: Partial<Event> = {}) => ev(who, JSON.stringify(target), { kind: 6, created_at: at, tags: [['e', target.id], ['p', target.pubkey]], ...over })
const world = (events: Event[]): Fetcher => ({ query: async (f) => events.filter((e) => answers(f, e)).slice(0, f.limit ?? 1000) })
const ctx = () => contextOf({ me, follows: new Set([ana, bob]), muted: new Set(), mutedWords: [], graphInfo: buildGraph(me, new Set([ana, bob]), new Map([[ana, [pk('c')]], [bob, [pk('d')]]])) })

describe('repostRefs', () => {
  const original = ev(stranger, 'the original', { created_at: 100 })
  it('reads kind 6 and kind 16, pointing at the LAST e tag, and keeps a copy only when it is exactly the note and its signature holds', () => {
    const [a] = repostRefs([repost(ana, original, 200)], yes); expect(a).toMatchObject({ reposter: ana, at: 200, targetId: original.id }); expect(a!.copy!.content).toBe('the original')
    const [b] = repostRefs([ev(bob, '', { kind: 16, created_at: 300, tags: [['e', 'c'.repeat(64)], ['e', original.id], ['k', '1']] })], yes); expect(b).toMatchObject({ targetId: original.id, copy: null })
    expect(repostRefs([repost(ana, original, 200)], () => false)[0]!.copy).toBeNull() // bad signature: the copy is not used
    expect(repostRefs([repost(ana, original, 200, { content: JSON.stringify({ ...original, id: 'd'.repeat(64) }) })], yes)[0]!.copy).toBeNull() // not the note it points at
    expect(repostRefs([repost(ana, original, 200, { content: JSON.stringify({ ...original, kind: 30023 }) })], yes)[0]!.copy).toBeNull() // not a text note
  })
  it('ignores what is not a usable repost: no target, junk, other kinds, generic reposts of something else, absurd copies', () => {
    const bad = [ev(ana, '', { kind: 6, tags: [] }), ev(ana, '', { kind: 6, tags: [['e', 'nothex']] }), ev(ana, 'x', { kind: 1, tags: [['e', original.id]] }), ev(ana, '', { kind: 16, tags: [['e', original.id], ['k', '30023']] })]
    expect(repostRefs(bad, yes)).toEqual([])
    expect(repostRefs([repost(ana, original, 1, { content: 'x'.repeat(30_000) }), repost(ana, original, 1, { content: '{not json' })], yes).map((r) => r.copy)).toEqual([null, null])
  })
  it('a real signature is checked for real', () => {
    const sk = generateSecretKey(), signed = finalizeEvent({ kind: 1, created_at: 100, tags: [], content: 'signed for real' }, sk)
    expect(repostRefs([repost(ana, signed, 200)])[0]!.copy!.content).toBe('signed for real')
    expect(repostRefs([repost(ana, { ...signed, content: 'tampered' }, 200, { content: JSON.stringify({ ...signed, content: 'tampered' }) })])[0]!.copy).toBeNull()
    expect(getPublicKey(sk)).toBe(signed.pubkey)
  })
})

describe('mergeFeed', () => {
  const o1 = ev(stranger, 'o1', { created_at: 100 }), o2 = ev(stranger, 'o2', { created_at: 120 }), mine = ev(ana, 'own post', { created_at: 150 })
  const ref = (who: string, o: Event, at: number) => ({ reposter: who, at, targetId: o.id, copy: o })
  it('puts reposts in time order by when they were reposted, with who reposted them', () => {
    const items = mergeFeed([mine], [ref(ana, o1, 300), ref(bob, o2, 200)], new Map(), 50)
    expect(items.map((i) => [i.event.content, i.repostedBy])).toEqual([['o1', [ana]], ['o2', [bob]], ['own post', []]])
  })
  it('a note posted and also reposted is one entry; several reposters are listed once each; the newest repost sets its place', () => {
    const items = mergeFeed([mine], [ref(bob, mine, 400), ref(bob, mine, 300), ref(me, mine, 250)], new Map(), 50)
    expect(items).toHaveLength(1); expect(items[0]).toMatchObject({ repostedBy: [bob, me], at: 400 })
  })
  it('reposting your own note does not count; an original that cannot be found is skipped; the limit applies', () => {
    expect(mergeFeed([], [ref(stranger, o1, 300)], new Map(), 5)).toEqual([]); expect(mergeFeed([], [{ reposter: ana, at: 300, targetId: 'e'.repeat(64), copy: null }], new Map(), 5)).toEqual([])
    expect(mergeFeed([mine, o1, o2], [], new Map(), 2).map((i) => i.event.content)).toEqual(['own post', 'o2'])
  })
})

describe('fetchOriginals', () => {
  it('asks the relays only for what did not come with a valid copy, and takes only text notes with the id asked', async () => {
    const o1 = ev(stranger, 'o1'), o2 = ev(stranger, 'o2'), asked: string[][] = []
    const f: Fetcher = { query: async (q) => { asked.push(q.ids ?? []); return [o2, ev(stranger, 'wrong kind', { id: o2.id, kind: 7 })].filter((e) => answers(q, e)) } }
    const got = await fetchOriginals(f, [{ reposter: ana, at: 1, targetId: o1.id, copy: o1 }, { reposter: bob, at: 2, targetId: o2.id, copy: null }])
    expect([...got.keys()].sort()).toEqual([o1.id, o2.id].sort()); expect(asked).toEqual([[o2.id]]); expect(got.get(o2.id)!.content).toBe('o2')
  })
})

describe('loadFollowing with reposts', () => {
  const orig = ev(stranger, 'something from a stranger', { created_at: 100 })
  const own = ev(ana, 'ana says hi', { created_at: 150 })
  it('is unchanged when reposts are off, and adds them (marked, judged by the ORIGINAL author) when on', async () => {
    const f = world([own, orig, repost(ana, orig, 300)]) // the copy inside the repost has no real signature here, so the original is fetched by id
    expect((await loadFollowing(f, ctx())).map((j) => j.event.content)).toEqual(['ana says hi'])
    const on = await loadFollowing(f, ctx(), undefined, { reposts: true })
    expect(on.map((j) => [j.event.content, j.repostedBy ?? null])).toEqual([['something from a stranger', [ana]], ['ana says hi', null]])
    expect(on[0]!.verdict).toMatchObject({ hidden: true, rule: 'outside-network' }) // a repost does not vouch for a stranger: the filter says so
    expect(on[1]!.verdict.hidden).toBe(false)
  })
  it('a muted account\'s reposts do not count, and the muted word still hides what was reposted', async () => {
    const c = contextOf({ me, follows: new Set([ana, bob]), muted: new Set([bob]), mutedWords: ['stranger'], graphInfo: buildGraph(me, new Set([ana, bob]), new Map([[ana, [pk('c')]], [bob, [pk('d')]]])) })
    const out = await loadFollowing(world([orig, repost(bob, orig, 300)]), c, undefined, { reposts: true }); expect(out).toEqual([])
    const out2 = await loadFollowing(world([orig, repost(ana, orig, 300)]), c, undefined, { reposts: true }); expect(out2[0]!.verdict).toMatchObject({ hidden: true, rule: 'muted-word' })
  })
  it('a relay that fails on reposts does not take the normal feed down', async () => {
    const f: Fetcher = { query: async (q) => { if (q.kinds?.includes(6)) throw new Error('boom'); return [own].filter((e) => answers(q, e)) } }
    expect((await loadFollowing(f, ctx(), undefined, { reposts: true })).map((j) => j.event.content)).toEqual(['ana says hi'])
  })
})
