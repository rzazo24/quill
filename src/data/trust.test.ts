import { describe, expect, it } from 'vitest'
import { ev, pk } from '../core/testutil.js'
import type { Context } from '../core/verdict.js'
import { followersOf, loadTrust, scoreTrust } from './trust.js'

const now = 100 * 86400
describe('trust score (the same as nostrclaw)', () => {
  it('adds the points with a reason each, caps at 100, and names the level', () => {
    const s = scoreTrust({ followers: 25, establishedFollowers: 16, seedDistance: 1, engagers: 4, oldestSeen: now - 40 * 86400, hasProfile: true, now })
    expect(s.score).toBe(40 + 15 + 15 + 10 + 10 + 5); expect(s.level).toBe('established')
    expect(s.reasons.map((r) => [r.key, r.points, r.n])).toEqual([['youFollow', 40, undefined], ['followers', 15, 25], ['established', 15, 16], ['engagers', 10, 4], ['seen30', 10, 40], ['profile', 5, undefined]])
    expect(scoreTrust({ followers: 2, establishedFollowers: 1, engagers: 1, hasProfile: true, now }).level).toBe('unknown') // 5+5+5+5 = 20
    expect(scoreTrust({ followers: 6, establishedFollowers: 1, seedDistance: 2, engagers: 0, hasProfile: false, now })).toMatchObject({ score: 35, level: 'some' })
    expect(scoreTrust({ followers: 99, establishedFollowers: 99, seedDistance: 0, engagers: 99, oldestSeen: 0, hasProfile: true, now }).score).toBe(100)
  })
  it('followers count each key once, from its NEWEST list, never itself', () => {
    const t = pk('9')
    const lists = [ev(pk('a'), '', { kind: 3, created_at: 1, tags: [['p', t]] }), ev(pk('a'), '', { kind: 3, created_at: 2, tags: [] }), ev(pk('b'), '', { kind: 3, created_at: 1, tags: [['p', t], ['p', t]] }), ev(t, '', { kind: 3, created_at: 1, tags: [['p', t]] })]
    expect([...followersOf(lists, [t]).get(t)!]).toEqual([pk('b')])
  })
  it('asks the relays and puts the facts together', async () => {
    const t = pk('9'), me = pk('1')
    const followers = ['a', 'b', 'c', 'd', 'e'].map((c) => pk(c))
    const events = [
      ...followers.map((f) => ev(f, '', { kind: 3, created_at: 10, tags: [['p', t]] })),
      ...['6', '7', '8'].map((c) => ev(pk(c), '', { kind: 3, created_at: 10, tags: [['p', pk('a')], ['p', pk('b')]] })), // a and b are established (3 followers each)
      ev(pk('6'), 'hi', { kind: 1, tags: [['p', t]] }), ev(pk('7'), '+', { kind: 7, tags: [['e', 'f'.repeat(64)], ['p', t]] }),
    ]
    const f = { query: async (flt: { kinds?: number[]; '#p'?: string[] }) => events.filter((e) => (!flt.kinds || flt.kinds.includes(e.kind)) && (!flt['#p'] || e.tags.some((x) => x[0] === 'p' && flt['#p']!.includes(x[1]!)))) }
    const ctx: Context = { me, follows: new Set(), muted: new Set(), mutedWords: [], graph: { loaded: true, distance: (k) => (k === t ? 2 : null) } }
    const own = [ev(t, '{"name":"T"}', { kind: 0, created_at: now - 10 * 86400 })]
    const s = await loadTrust(f as never, t, ctx, own, now)
    expect(s.reasons.map((r) => [r.key, r.n])).toEqual([['networkFollows', undefined], ['followers', 5], ['established', 2], ['engagers', 2], ['seen7', 10], ['profile', undefined]])
    expect(s.score).toBe(20 + 10 + 5 + 5 + 5 + 5)
  })
})
