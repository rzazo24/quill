import { describe, expect, it } from 'vitest'
import { ev, pk } from '../core/testutil.js'
import { hasReach, loadOthersReach, loadReach, reachOf } from './reach.js'
import type { QueryOptions } from '../net/fetcher.js'

const me = pk('1'), a = pk('a'), b = pk('b'), c = pk('c'), muted = pk('d')
const mine = ev(me, 'my note'), other = ev(me, 'another note of mine'), quiet = ev(me, 'nobody noticed')
const ids = [mine.id, other.id, quiet.id]
const react = (who: string, target: string, content: string) => ev(who, content, { kind: 7, tags: [['e', target], ['p', me]] })
const repost = (who: string, target: string, kind = 6) => ev(who, '', { kind, tags: [['e', target], ['p', me]] })
const reply = (who: string, target: string, text = 'a reply') => ev(who, text, { tags: [['e', target, '', 'reply'], ['p', me]] })
const ctx = { me, muted: new Set([muted]) }

describe('what a note got', () => {
  it('counts reactions by emoji (and + as a thumb), reposts and replies, per note', () => {
    const r = reachOf([react(a, mine.id, '❤️'), react(b, mine.id, '❤'), react(c, mine.id, '+'), repost(a, mine.id), repost(b, mine.id, 16), reply(c, mine.id), react(a, other.id, '🔥')], ids, ctx)
    expect([...r.get(mine.id)!.reactions]).toEqual([['❤', 2], ['👍', 1]]); expect(r.get(mine.id)!.reposts).toBe(2); expect(r.get(mine.id)!.replies).toBe(1)
    expect([...r.get(other.id)!.reactions]).toEqual([['🔥', 1]]); expect(r.has(quiet.id)).toBe(false) // a note that got nothing has no entry
  })
  it('counts a person once per emoji and once per repost, a quote like a reply, and never the reader or a muted account', () => {
    const quote = ev(b, 'look at this nostr:nevent…', { tags: [['q', mine.id], ['p', me]] })
    const r = reachOf([react(a, mine.id, '❤️'), react(a, mine.id, '❤️'), repost(a, mine.id), repost(a, mine.id), quote, quote, react(me, mine.id, '❤️'), repost(me, mine.id), reply(me, mine.id), react(muted, mine.id, '🔥'), reply(muted, mine.id), repost(muted, mine.id)], ids, ctx).get(mine.id)!
    expect([...r.reactions]).toEqual([['❤', 1]]); expect(r.reposts).toBe(1); expect(r.replies).toBe(1)
  })
  it('ignores what is not about the notes asked for, and a reply to a reply is a reply to that one, not to the note', () => {
    const elsewhere = ev(a, 'x'), deep = ev(b, 'a reply to a reply', { tags: [['e', mine.id, '', 'root'], ['e', reply(a, mine.id).id, '', 'reply']] })
    const r = reachOf([react(a, elsewhere.id, '❤️'), repost(a, elsewhere.id), deep], ids, ctx)
    expect(r.size).toBe(0)
  })
  it('knows when there is nothing to show', () => { expect(hasReach(undefined)).toBe(false); expect(hasReach({ reactions: new Map(), reposts: 0, replies: 0 })).toBe(false); expect(hasReach({ reactions: new Map(), reposts: 1, replies: 0 })).toBe(true) })
  it('every question for the numbers stops waiting for a slow relay soon after the others answered (zaps too: they used to wait for every relay)', async () => {
    const asked: (QueryOptions | undefined)[] = [], f = { query: async (_: unknown, o?: QueryOptions) => { asked.push(o); return [] } }
    await loadReach(f, [mine.id], ctx); await loadOthersReach(f, [mine.id], ctx)
    expect(asked.length).toBe(7); expect(asked.every((o) => o?.quick === true)).toBe(true)
  })
})
