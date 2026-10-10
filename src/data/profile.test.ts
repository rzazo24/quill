import { describe, expect, it } from 'vitest'
import { ev, pk } from '../core/testutil.js'
import { contextOf } from './session.js'
import { buildGraph } from './graph.js'
import { followedVia, followingCount, loadProfile, profileFields } from './profile.js'
import { answers, type Fetcher } from '../net/fetcher.js'

const me = pk('1'), ana = pk('a'), bob = pk('b'), eva = pk('e'), muted = pk('9')
const prof = (who: string, p: Record<string, unknown>, at = 100) => ev(who, JSON.stringify(p), { kind: 0, created_at: at })
const follows3 = (who: string, list: string[], at = 100) => ev(who, '', { kind: 3, created_at: at, tags: list.map((x) => ['p', x]) })
const world = (events: ReturnType<typeof ev>[]): Fetcher => ({ query: async (f) => events.filter((e) => answers(f, e)).slice(0, f.limit ?? 1000) })
const session = (lists: Record<string, string[]> = {}, m: string[] = []) => ({ me, follows: new Set([ana, bob]), muted: new Set(m), mutedWords: [], graphInfo: buildGraph(me, new Set([ana, bob]), new Map(Object.entries(lists))) })
const ctxOf = (s = session()) => contextOf(s)

describe('profileFields', () => {
  it('reads the text fields, cleaned and capped, never throws, and never looks at pictures', () => {
    const f = profileFields(prof(eva, { name: 'Eva', about: 'hello\n\nworld', nip05: 'eva@example.com', website: 'https://eva.example', picture: 'https://x/evil.png', banner: 'https://x/b.png' }))
    expect(f).toEqual({ name: 'Eva', about: 'hello\n\nworld', nip05: 'eva@example.com', website: 'https://eva.example' }); expect(JSON.stringify(f)).not.toContain('evil')
    expect(profileFields(undefined)).toEqual({}); expect(profileFields({ content: 'not json' })).toEqual({})
    const long = profileFields(prof(eva, { about: 'x'.repeat(5000), name: 42, nip05: ['x'] })); expect(long.about!.length).toBeLessThan(1050); expect(long.about).toContain('[+'); expect(long.name).toBeUndefined(); expect(long.nip05).toBeUndefined()
  })
})
describe('who an account follows and who follows it', () => {
  it('counts the distinct valid accounts of the newest list; none found is null', () => {
    expect(followingCount(follows3(eva, [ana, bob, ana, 'junk']))).toBe(2); expect(followingCount(follows3(eva, []))).toBe(0); expect(followingCount(undefined)).toBeNull()
  })
  it('lists your follows whose lists name the account (and only your follows)', () => {
    const s = session({ [ana]: [eva], [bob]: [muted], [pk('8')]: [eva] }); expect(followedVia(s, eva)).toEqual([ana]); expect(followedVia(s, pk('7'))).toEqual([])
  })
})
describe('loadProfile', () => {
  it('has the profile of the newest kind 0, how many it follows, who of yours follows it, and ONLY its own notes, newest first', async () => {
    const s = session({ [ana]: [eva] })
    const f = world([prof(eva, { name: 'Old' }, 10), prof(eva, { name: 'Eva', about: 'about me' }, 50), follows3(eva, [ana, bob, muted], 60), follows3(eva, [ana], 10), ev(eva, 'first', { created_at: 70 }), ev(eva, 'second', { created_at: 80 }), ev(ana, 'not eva', { created_at: 90 })])
    const { info, notes } = await loadProfile(f, eva, s, ctxOf(s))
    expect(info).toMatchObject({ pubkey: eva, name: 'Eva', about: 'about me', following: 3, via: [ana] }); expect(notes.map((j) => j.event.content)).toEqual(['second', 'first'])
  })
  it('an account nobody knows is an empty page, not an error; a relay returning other people\'s events cannot put them on this page', async () => {
    const s = session(); const { info, notes } = await loadProfile(world([]), eva, s, ctxOf(s)); expect(info).toEqual({ pubkey: eva, following: null, via: [] }); expect(notes).toEqual([])
    const hostile: Fetcher = { query: async () => [ev(ana, 'sneaked in', { created_at: 5 }), prof(ana, { name: 'Impostor' }), ev(eva, 'mine', { created_at: 6 })] }
    const r = await loadProfile(hostile, eva, s, ctxOf(s)); expect(r.notes.map((j) => j.event.content)).toEqual(['mine']); expect(r.info.name).toBeUndefined()
  })
  it('judges the notes like the rest, except "outside your network" (you opened it on purpose): muted accounts and bursts still fold', async () => {
    const s = session({ [ana]: [], [bob]: [] }); const strict = { rules: { repeatedText: true, burst: true, linkOnly: true, outsideNetwork: true }, maxDistance: 1, burstEvents: 5 }
    const out = await loadProfile(world([ev(eva, 'a normal note', { created_at: 1000 })]), eva, s, ctxOf(s), strict); expect(out.notes[0]!.verdict.hidden).toBe(false)
    const m = session({}, [eva]); expect((await loadProfile(world([ev(eva, 'x y z', { created_at: 5 })]), eva, m, ctxOf(m))).notes[0]!.verdict).toMatchObject({ hidden: true, rule: 'muted-author' })
    const burst = Array.from({ length: 6 }, (_, i) => ev(eva, `burst note number ${i}`, { created_at: 2000 + i })); expect((await loadProfile(world(burst), eva, s, ctxOf(s))).notes.some((j) => j.verdict.hidden && j.verdict.rule === 'burst')).toBe(true)
  })
})
