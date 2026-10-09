import { describe, expect, it } from 'vitest'
import { ev, pk } from '../core/testutil.js'
import { contextOf } from './session.js'
import { buildGraph } from './graph.js'
import { countNew, groupReactions, loadActivity, reactionTarget, showReaction } from './activity.js'
import { answers, type Fetcher } from '../net/fetcher.js'

const me = pk('1'), friend = pk('a'), stranger = pk('f'), other = pk('b')
const myNote = ev(me, 'my own note about relays', { created_at: 100 }), someoneElses = ev(other, 'a note of somebody else', { created_at: 100 })
const world = (events = [] as ReturnType<typeof ev>[]): Fetcher => { const all = [myNote, someoneElses, ...events]; return { query: async (f) => all.filter((e) => answers(f, e)).slice(0, f.limit ?? 1000) } }
const sess = (graph: Record<string, number> = {}) => contextOf({ me, follows: new Set([friend]), muted: new Set(), mutedWords: [], graphInfo: buildGraph(me, new Set([friend]), new Map([[friend, Object.keys(graph)]])) })
const react = (who: string, target: string, content = '❤️', at = 200, extra: string[][] = []) => ev(who, content, { kind: 7, created_at: at, tags: [['e', target], ['p', me], ...extra] })
const reply = (who: string, text: string, at = 200) => ev(who, text, { created_at: at, tags: [['e', myNote.id, '', 'root'], ['p', me]] })

describe('loadActivity', () => {
  it('collects replies/mentions from others and reactions to the reader\'s own notes, never their own events', async () => {
    const a = await loadActivity(world([reply(friend, 'hello'), react(friend, myNote.id), ev(me, 'self', { tags: [['p', me]] }), react(me, myNote.id)]), sess())
    expect(a.notes.map((j) => j.event.content)).toEqual(['hello']); expect(a.reactions).toHaveLength(1); expect(a.targets.get(myNote.id)).toBeDefined()
  })
  it('a reaction that only NAMES the reader in its p tag, to somebody else\'s note, is not activity on their notes', async () => {
    const forged = react(stranger, someoneElses.id) // p = me, but the note is not mine
    const missing = react(stranger, 'c'.repeat(64)) // a note nobody can find
    const a = await loadActivity(world([forged, missing]), sess())
    expect(a.reactions).toEqual([])
  })
  it('the filter judges them like everything else: a stranger outside the network is hidden, a friend is not', async () => {
    const a = await loadActivity(world([react(friend, myNote.id), react(stranger, myNote.id, '🔥'), reply(stranger, 'buy my thing now at the link')]), sess())
    const by = Object.fromEntries(a.reactions.map((j) => [j.event.pubkey, j.verdict.hidden]))
    expect(by[friend]).toBe(false); expect(by[stranger]).toBe(true); expect(a.notes[0]!.verdict).toMatchObject({ hidden: true, rule: 'outside-network' })
  })
})

describe('countNew', () => {
  it('counts what is newer than the last visit that the filter SHOWS, and counts the hidden ones apart', async () => {
    const a = await loadActivity(world([reply(friend, 'new reply', 300), reply(friend, 'old reply', 50), reply(stranger, 'new but hidden', 300), react(friend, myNote.id, '❤️', 300), react(stranger, myNote.id, '🔥', 300)]), sess())
    expect(countNew(a, 100)).toEqual({ shown: 2, hidden: 2 }) // the new reply + the friend's reaction; the stranger's note and reaction are hidden
    expect(countNew(a, 1000)).toEqual({ shown: 0, hidden: 0 }); expect(countNew(a, 0).shown).toBe(3)
  })
  it('one person reacting several times to the same note is one item', async () => {
    const a = await loadActivity(world([react(friend, myNote.id, '❤️', 300), react(friend, myNote.id, '🔥', 301), react(friend, myNote.id, '🙏', 302)]), sess())
    expect(countNew(a, 100).shown).toBe(1)
  })
})

describe('groupReactions', () => {
  it('groups by note, distinct people and emoji, newest first, and marks what is fresh', async () => {
    const second = ev(me, 'another note of mine', { created_at: 110 })
    const f: Fetcher = { query: async (q) => [myNote, second, react(friend, myNote.id, '❤️', 300), react(friend, myNote.id, '+', 305), react(other, myNote.id, '❤️', 310, []), react(friend, second.id, '🔥', 250)].filter((e) => answers(q, e)) }
    const a = await loadActivity(f, sess({ [other]: 2 }))
    const groups = groupReactions(a, 280)
    expect(groups.map((g) => g.target.id)).toEqual([myNote.id, second.id])
    expect(groups[0]).toMatchObject({ emojis: ['❤️', '👍'], latest: 310, fresh: true }); expect(groups[0]!.by).toEqual([other, friend])
    expect(groups[1]).toMatchObject({ fresh: false, emojis: ['🔥'] })
  })
  it('hidden reactions are not shown in groups', async () => {
    const a = await loadActivity(world([react(stranger, myNote.id, '🔥')]), sess()); expect(groupReactions(a, 0)).toEqual([])
  })
})

describe('small helpers', () => {
  it('the target of a reaction is the last e tag; + is a like, - a dislike', () => {
    expect(reactionTarget({ tags: [['e', 'a'.repeat(64)], ['e', 'b'.repeat(64)]] })).toBe('b'.repeat(64)); expect(reactionTarget({ tags: [['e', 'zz']] })).toBeUndefined()
    expect([showReaction('+'), showReaction('-'), showReaction('🔥'), showReaction('')]).toEqual(['👍', '👎', '🔥', '👍'])
  })
})
