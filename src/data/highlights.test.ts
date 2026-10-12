import { describe, expect, it } from 'vitest'
import { ev, pk } from '../core/testutil.js'
import { broughtIn, ownWords, pickHighlights, signalsOf } from './highlights.js'

const me = pk('1'), a = pk('a'), b = pk('b'), c = pk('c'), stranger = pk('f'), other = pk('e')
const follows = new Set([a, b, c])
const long = (n: number) => Array.from({ length: n }, (_, i) => `word${String.fromCharCode(97 + (i % 26))}x`).join(' ')

describe('highlights', () => {
  it('own words leave out links, nostr: references, #tags and handles', () => {
    expect(ownWords('hello world https://x.example/a nostr:npub1abc #tag @someone ok')).toBe(3)
  })
  it('signals: who of your follows replied or quoted (talked), reposted (shared) or reacted (liked); strangers and you do not count', () => {
    const n = ev(stranger, long(50), { created_at: 100 })
    const s = signalsOf([
      ev(a, 'reply', { tags: [['e', n.id, '', 'root']], created_at: 200 }), ev(b, '', { kind: 6, tags: [['e', n.id]], created_at: 200 }),
      ev(c, '+', { kind: 7, tags: [['e', n.id]], created_at: 200 }), ev(other, 'reply', { tags: [['e', n.id, '', 'root']], created_at: 200 }), ev(me, '+', { kind: 7, tags: [['e', n.id]], created_at: 200 }),
    ], follows, me).get(n.id)!
    expect([...s.talked]).toEqual([a]); expect([...s.shared]).toEqual([b]); expect([...s.liked]).toEqual([c])
  })
  it('a stranger comes in only if your follows talked about it or two of them shared it; short notes, replies and yours never', () => {
    const talked = ev(stranger, long(60), { created_at: 10 }), sharedOnce = ev(other, long(60), { created_at: 11 }), sharedTwice = ev(pk('d'), long(60), { created_at: 12 })
    const short = ev(a, 'gm everyone', { created_at: 13 }), mine = ev(me, long(60), { created_at: 14 }), followed = ev(a, long(60), { created_at: 15 })
    const signals = signalsOf([ev(a, 'r', { tags: [['e', talked.id, '', 'root']] }), ev(b, '', { kind: 6, tags: [['e', sharedOnce.id]] }), ev(b, '', { kind: 6, tags: [['e', sharedTwice.id]] }), ev(c, '', { kind: 6, tags: [['e', sharedTwice.id]] })], follows, me)
    expect(broughtIn(signals.get(sharedOnce.id))).toBe(false); expect(broughtIn(signals.get(sharedTwice.id))).toBe(true)
    const picked = pickHighlights([talked, sharedOnce, sharedTwice, short, mine, followed], signals, new Map(), follows, me).map((e) => e.id)
    expect(picked).toContain(talked.id); expect(picked).toContain(sharedTwice.id); expect(picked).toContain(followed.id)
    expect(picked).not.toContain(sharedOnce.id); expect(picked).not.toContain(short.id); expect(picked).not.toContain(mine.id)
  })
  it('talk outweighs likes, and no author gets more than two places', () => {
    const liked = ev(a, long(60), { created_at: 20 }), discussed = ev(b, long(60), { created_at: 10 })
    const many = [1, 2, 3, 4].map((i) => ev(c, `${long(60)} ${i}`, { created_at: 30 + i }))
    const signals = signalsOf([ev(a, '+', { kind: 7, tags: [['e', liked.id]] }), ev(c, 'r', { tags: [['e', discussed.id, '', 'root']] })], follows, me)
    const picked = pickHighlights([liked, discussed, ...many], signals, new Map(), follows, me)
    expect(picked[0]!.id).toBe(discussed.id)
    expect(picked.filter((e) => e.pubkey === c)).toHaveLength(2)
  })
})
