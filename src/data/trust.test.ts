import { describe, expect, it } from 'vitest'
import { ev, pk } from '../core/testutil.js'
import type { Context } from '../core/verdict.js'
import { followersOf, loadTrust, scoreTrust } from './trust.js'

const now = 100 * 86400
describe('trust score (the same as nostrclaw)', () => {
  it('adds the points with a reason each; the LEVEL comes from your network, not from followers elsewhere', () => {
    const s = scoreTrust({ followers: 25, establishedFollowers: 16, seedDistance: 1, networkFollowers: 12, mutedByNetwork: 0, engagers: 4, oldestSeen: now - 40 * 86400, hasProfile: true, now })
    expect(s.score).toBe(100); expect(s.level).toBe('established')
    expect(s.reasons.map((r) => [r.key, r.points, r.n])).toEqual([['youFollow', 40, undefined], ['network', 40, 12], ['followers', 8, 25], ['established', 12, 16], ['engagers', 8, 4], ['seen30', 8, 40], ['profile', 4, undefined]])
    // a ring of fake accounts: hundreds of followers, "established" ones, engagement, age — but nobody you follow follows it
    const ring = scoreTrust({ followers: 500, establishedFollowers: 80, networkFollowers: 0, mutedByNetwork: 0, engagers: 90, oldestSeen: now - 100 * 86400, hasProfile: true, now })
    expect(ring.level).toBe('unknown'); expect(ring.score).toBe(40)
    expect(scoreTrust({ followers: 2, establishedFollowers: 0, networkFollowers: 1, mutedByNetwork: 0, engagers: 0, hasProfile: false, now }).level).toBe('some') // one of your follows is some backing
    expect(scoreTrust({ followers: 2, establishedFollowers: 0, networkFollowers: 3, mutedByNetwork: 0, engagers: 0, hasProfile: false, now }).level).toBe('established')
  })
  it('being muted by your network takes points and lowers the level', () => {
    const muted3 = scoreTrust({ followers: 30, establishedFollowers: 10, networkFollowers: 4, mutedByNetwork: 3, engagers: 5, hasProfile: true, now })
    expect(muted3.level).toBe('some'); expect(muted3.reasons.at(-1)).toEqual({ points: -30, key: 'mutedByNetwork', n: 3 })
    expect(scoreTrust({ followers: 30, establishedFollowers: 10, networkFollowers: 1, mutedByNetwork: 3, engagers: 5, hasProfile: true, now }).level).toBe('unknown')
    expect(scoreTrust({ followers: 30, establishedFollowers: 10, seedDistance: 1, networkFollowers: 9, mutedByNetwork: 5, engagers: 5, hasProfile: true, now }).level).toBe('unknown')
    expect(scoreTrust({ followers: 0, establishedFollowers: 0, networkFollowers: 0, mutedByNetwork: 9, engagers: 0, hasProfile: false, now }).score).toBe(0) // never below 0
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
      ev(pk('7'), '', { kind: 10000, tags: [['p', t]] }), ev(pk('8'), '', { kind: 10000, tags: [['p', t]] }), // muted by one of your follows (7) and by a stranger (8, does not count)
    ]
    const f = { query: async (flt: { kinds?: number[]; '#p'?: string[] }) => events.filter((e) => (!flt.kinds || flt.kinds.includes(e.kind)) && (!flt['#p'] || e.tags.some((x) => x[0] === 'p' && flt['#p']!.includes(x[1]!)))) }
    const ctx: Context = { me, follows: new Set([pk('a'), pk('b'), pk('7')]), muted: new Set(), mutedWords: [], graph: { loaded: true, distance: () => null } }
    const own = [ev(t, '{"name":"T"}', { kind: 0, created_at: now - 10 * 86400 })]
    const s = await loadTrust(f as never, t, ctx, own, now)
    expect(s.reasons.map((r) => [r.key, r.n])).toEqual([['network', 2], ['followers', 5], ['established', 2], ['engagers', 2], ['seen7', 10], ['profile', undefined], ['mutedByNetwork', 1]])
    expect(s.score).toBe(25 + 5 + 4 + 4 + 4 + 4 - 15); expect(s.level).toBe('some')
  })
})
