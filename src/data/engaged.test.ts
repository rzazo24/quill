import { describe, expect, it } from 'vitest'
import { ev, pk } from '../core/testutil.js'
import { Engagement, engagementOf, loadEngagement, normReaction } from './engaged.js'
import { answers, type Fetcher } from '../net/fetcher.js'

const me = pk('1'), other = pk('2'), n1 = 'a'.repeat(64), n2 = 'b'.repeat(64), n3 = 'c'.repeat(64)
const react = (content: string, tags: string[][], who = me) => ev(who, content, { kind: 7, tags })

describe('what the reader already did', () => {
  it('reactions are attached to the note named by the LAST e tag (NIP-25), several per note allowed', () => {
    const e = engagementOf([react('❤️', [['e', n1], ['p', other]]), react('+', [['e', n1]]), react('🔥', [['e', n3], ['e', n2], ['p', other]])], me)
    expect([...e.of(n1).reactions].sort()).toEqual(['+', '❤'].sort()); expect([...e.of(n2).reactions]).toEqual(['🔥']); expect(e.of(n3).reactions.size).toBe(0)
  })
  it('❤ and ❤️ are the same reaction', () => {
    expect(normReaction('❤️')).toBe(normReaction('❤')); const e = new Engagement(); e.addReaction(n1, '❤️'); e.addReaction(n1, '❤'); expect(e.of(n1).reactions.size).toBe(1)
  })
  it('a reply marks the note it answers (the direct parent), not the root; a reply to a root note marks the root', () => {
    const root = ev(other, 'root'), mid = ev(other, 'mid', { tags: [['e', root.id, '', 'root']] })
    const mine = ev(me, 'my answer', { tags: [['e', root.id, '', 'root'], ['e', mid.id, '', 'reply']] }), direct = ev(me, 'answer to a root', { tags: [['e', n1, '', 'root']] })
    const e = engagementOf([mine, direct, ev(me, 'a plain note, not a reply')], me)
    expect(e.of(mid.id).replied).toBe(true); expect(e.of(root.id).replied).toBe(false); expect(e.of(n1).replied).toBe(true)
  })
  it('only the reader\'s own events count, and only reactions and notes', () => {
    const e = engagementOf([react('❤️', [['e', n1]], other), ev(other, 'x', { tags: [['e', n2, '', 'reply']] }), ev(me, 'x', { kind: 6, tags: [['e', n3]] })], me)
    expect(e.of(n1).reactions.size + Number(e.of(n2).replied) + Number(e.of(n3).replied)).toBe(0)
  })
  it('malformed events never throw and never count', () => {
    const e = engagementOf([react('❤️', []), react('❤️', [['e', 'nothex']]), react('', [['e', n1]]), ev(me, 'x', { tags: [['e', 'zz', '', 'reply']] })], me)
    expect(e.of(n1).reactions.size).toBe(0); expect(e.of('zz').replied).toBe(false)
    const local = new Engagement(); local.addReaction('nothex', '❤️'); local.addReply('nothex'); local.addRepost('nothex'); expect(local.of('nothex')).toEqual({ reactions: new Set(), replied: false, reposted: false })
  })
  it('loads the reader\'s reactions and notes from the relays', async () => {
    const world = [react('🙏', [['e', n1]]), ev(me, 'reply', { tags: [['e', n2, '', 'root']] }), react('❤️', [['e', n3]], other)]
    const f: Fetcher = { query: async (filter) => world.filter((x) => answers(filter, x)) }
    const e = await loadEngagement(f, me)
    expect([...e.of(n1).reactions]).toEqual(['🙏']); expect(e.of(n2).replied).toBe(true); expect(e.of(n3).reactions.size).toBe(0)
  })
})

describe('what the reader already shared', () => {
  const me = pk('1'), other = pk('2'), n1 = 'a'.repeat(64), n2 = 'b'.repeat(64)
  it('knows the notes the reader reposted (kinds 6 and 16, the LAST e tag), and ignores other people\'s reposts', () => {
    const e = engagementOf([ev(me, '', { kind: 6, tags: [['e', 'c'.repeat(64)], ['e', n1], ['p', other]] }), ev(me, '', { kind: 16, tags: [['e', n2], ['k', '1']] }), ev(other, '', { kind: 6, tags: [['e', 'd'.repeat(64)]] })], me)
    expect(e.of(n1).reposted).toBe(true); expect(e.of(n2).reposted).toBe(true); expect(e.of('d'.repeat(64)).reposted).toBe(false); expect(e.of('c'.repeat(64)).reposted).toBe(false)
  })
  it('is read from the relays, and a failure on reposts only means nothing is marked', async () => {
    const world = [ev(me, '', { kind: 6, tags: [['e', n1]] }), ev(me, '❤️', { kind: 7, tags: [['e', n2]] })]
    expect((await loadEngagement({ query: async (f) => world.filter((e) => answers(f, e)) }, me)).of(n1).reposted).toBe(true)
    const broken: Fetcher = { query: async (f) => { if (f.kinds?.includes(6)) throw new Error('boom'); return world.filter((e) => answers(f, e)) } }
    const e = await loadEngagement(broken, me); expect(e.of(n1).reposted).toBe(false); expect([...e.of(n2).reactions]).toEqual(['❤'])
  })
  it('malformed reposts never throw and never count', () => {
    const e = engagementOf([ev(me, '', { kind: 6, tags: [] }), ev(me, '', { kind: 6, tags: [['e', 'nothex']] })], me); expect(e.of('nothex').reposted).toBe(false)
  })
})
