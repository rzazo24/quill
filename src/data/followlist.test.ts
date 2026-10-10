import { describe, expect, it } from 'vitest'
import { ev, pk } from '../core/testutil.js'
import { answers, type Fetcher } from '../net/fetcher.js'
import { addBackup, checkBase, loadFollowList, MAX_BACKUPS, nextKnown, parseBackups, shrinkMargin } from './followlist.js'

const me = pk('1'), other = pk('2')
const key = (n: number) => ('e' + n.toString(16).padStart(3, '0')).repeat(16)
const list = (who: string, keys: string[], at = 100) => ev(who, '', { kind: 3, created_at: at, tags: keys.map((k) => ['p', k]) })
const world = (events: ReturnType<typeof ev>[]): Fetcher => ({ query: async (f) => events.filter((e) => answers(f, e)).slice(0, f.limit ?? 1000) })
const keys = (n: number, from = 0) => Array.from({ length: n }, (_, i) => key(from + i))

describe('reading the reader\'s own list', () => {
  it('is the newest list of the reader (other people\'s lists and older versions do not count), or null', async () => {
    const f = world([list(me, keys(2), 100), list(me, keys(5), 300), list(me, keys(3), 200), list(other, keys(9), 400)])
    expect((await loadFollowList(f, me))!.tags).toHaveLength(5); expect(await loadFollowList(world([list(other, keys(3))]), me)).toBeNull()
    const hostile: Fetcher = { query: async () => [list(other, keys(50), 999)] }; expect(await loadFollowList(hostile, me)).toBeNull() // a relay returning somebody else's list
  })
})

describe('is the list one to build on?', () => {
  const known = (n: number) => new Set(keys(n))
  it('no list found: no (it could erase the real one); nothing known yet: fine', () => {
    expect(checkBase(null, known(10))).toEqual({ ok: false, why: 'none', known: 10, found: 0 }); expect(checkBase(list(me, keys(3)), null)).toEqual({ ok: true }); expect(checkBase(list(me, []), new Set())).toEqual({ ok: true })
  })
  it('the same list, a longer one, or one a few shorter (unfollowed elsewhere) is fine; one much shorter is not', () => {
    expect(checkBase(list(me, keys(100)), known(100))).toEqual({ ok: true }); expect(checkBase(list(me, keys(120)), known(100))).toEqual({ ok: true })
    expect(shrinkMargin(100)).toBe(5); expect(shrinkMargin(10)).toBe(3); expect(checkBase(list(me, keys(95, 5)), known(100))).toEqual({ ok: true }) // 5 missing
    expect(checkBase(list(me, keys(94, 6)), known(100))).toEqual({ ok: false, why: 'shrunk', known: 100, found: 94 }) // 6 missing
    expect(checkBase(list(me, keys(30)), known(119))).toMatchObject({ ok: false, why: 'shrunk', known: 119, found: 30 }); expect(checkBase(list(me, []), known(10))).toMatchObject({ ok: false, why: 'shrunk' })
  })
  it('a list with other accounts is judged by what is MISSING: the known ones must still be there', () => {
    expect(checkBase(list(me, keys(100, 50)), known(100))).toMatchObject({ ok: false, why: 'shrunk' })
  })
})

describe('what is remembered as followed', () => {
  it('follows the list, except that a suspiciously short one does not replace what was remembered', () => {
    expect([...nextKnown(null, new Set(keys(3)))]).toEqual(keys(3)); expect(nextKnown(new Set(), new Set(keys(3))).size).toBe(3)
    expect(nextKnown(new Set(keys(100)), new Set(keys(98))).size).toBe(98); expect(nextKnown(new Set(keys(100)), new Set(keys(20))).size).toBe(100)
  })
})

describe('backups of the list', () => {
  it('keeps the last few, newest first, each once; junk in storage is ignored', () => {
    let kept: ReturnType<typeof list>[] = []; for (let i = 0; i < 5; i++) kept = addBackup(kept, list(me, keys(i + 1), 100 + i))
    expect(kept).toHaveLength(MAX_BACKUPS); expect(kept.map((e) => e.tags.length)).toEqual([5, 4, 3]); expect(addBackup(kept, kept[0]!)).toHaveLength(MAX_BACKUPS)
    expect(parseBackups(JSON.stringify([kept[0], { kind: 1 }, 'x', null]))).toEqual([kept[0]]); for (const bad of [null, '', 'nope', '{}']) expect(parseBackups(bad), String(bad)).toEqual([])
  })
})
