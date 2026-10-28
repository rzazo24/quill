import { describe, expect, it, vi } from 'vitest'
import type { Event } from 'nostr-tools'
import { collectQuick, isPartial, isQuick, markPartial, memo, type Subscribe } from './fetcher.js'

const ev = (id: string) => ({ id, pubkey: 'p', kind: 1, content: '', tags: [], created_at: 1, sig: 's' }) as Event
/** Pretend relays: each answers after its own delay (null: never) with its own events. */
function fakeRelays(spec: Record<string, { after: number | null; events: string[] }>): Subscribe {
  return (url, _f, on) => {
    const r = spec[url]!; const timers: ReturnType<typeof setTimeout>[] = []
    if (r.after !== null) timers.push(setTimeout(() => { for (const id of r.events) on.onevent(ev(id)); on.oneose() }, r.after))
    return { close: () => timers.forEach(clearTimeout) }
  }
}
const urls = ['a', 'b', 'c', 'd', 'e', 'f']

describe('collectQuick: do not wait for the last relay', () => {
  it('answers when a majority has finished (plus a moment), without what a slow relay would have added, each event once', async () => {
    vi.useFakeTimers()
    const spec = Object.fromEntries(urls.map((u, i) => [u, { after: i < 4 ? 50 + i * 10 : 5000, events: i === 0 ? ['x', 'y'] : ['x'] }]))
    const p = collectQuick(fakeRelays(spec), urls, { kinds: [1] }); await vi.advanceTimersByTimeAsync(400)
    expect((await p).map((e) => e.id).sort()).toEqual(['x', 'y']); vi.useRealTimers()
  })
  it('asks, for each event, whether it was already received before the (costly) signature check: an event sent by six relays is checked once', async () => {
    vi.useFakeTimers(); let checked = 0
    const sub: Subscribe = (_url, _f, on) => { const t = setTimeout(() => { for (const id of ['a', 'b', 'c']) { if (!on.alreadyHaveEvent(id)) { checked++; on.onevent(ev(id)) } } on.oneose() }, 10); return { close: () => clearTimeout(t) } }
    const p = collectQuick(sub, urls, { kinds: [1] }); await vi.advanceTimersByTimeAsync(400)
    expect((await p).length).toBe(3); expect(checked).toBe(3); vi.useRealTimers() // six relays, three events: three checks, not eighteen
  })
  it('a relay that never answers or fails does not hold it back, and when everybody answers it does not wait for the grace', async () => {
    vi.useFakeTimers()
    const dead = collectQuick(fakeRelays({ a: { after: 30, events: ['1'] }, b: { after: null, events: [] }, c: { after: 40, events: ['2'] } }), ['a', 'b', 'c'], { kinds: [1] }); await vi.advanceTimersByTimeAsync(300)
    expect((await dead).map((e) => e.id).sort()).toEqual(['1', '2'])
    let t = 0; const all = collectQuick(fakeRelays({ a: { after: 10, events: ['q'] }, b: { after: 20, events: [] } }), ['a', 'b'], { kinds: [1] }).then((r) => { t = Date.now(); return r })
    const start = Date.now(); await vi.advanceTimersByTimeAsync(25); expect((await all).length).toBe(1); expect(t - start).toBeLessThan(100); vi.useRealTimers()
  })
  it('gives up after maxWait with what it has, and answers at once for an empty list of relays', async () => {
    vi.useFakeTimers()
    const p = collectQuick(fakeRelays({ a: { after: 10, events: ['k'] }, b: { after: null, events: [] }, c: { after: null, events: [] } }), ['a', 'b', 'c'], { kinds: [1] }, { maxWait: 1000 }); await vi.advanceTimersByTimeAsync(1100)
    expect((await p).map((e) => e.id)).toEqual(['k']); expect(await collectQuick(fakeRelays({}), [], { kinds: [1] })).toEqual([]); vi.useRealTimers()
  })
})

describe('which queries are quick', () => {
  it('notes, reposts, reactions, profiles and ids are; your own lists, follow lists and anything mixed with them are not (they must be complete)', () => {
    expect([{ kinds: [1] }, { kinds: [6, 16] }, { kinds: [7] }, { kinds: [0] }, { ids: ['a'] }, { kinds: [1], '#p': ['x'] }].map(isQuick)).toEqual([true, true, true, true, true, true])
    expect([{ kinds: [3] }, { kinds: [3, 10000] }, { kinds: [10002] }, { kinds: [0, 3] }, {}].map(isQuick)).toEqual([false, false, false, false, false])
  })
})

import { RelayHealth } from './fetcher.js'
describe('relays that keep failing are left alone for a while', () => {
  it('two failures in a row rest it 2 minutes, then longer (up to 15); one answer brings it back; never all of them at once', () => {
    let now = 0; const h = new RelayHealth(() => now)
    h.fail('a'); expect(h.usable(['a', 'b'])).toEqual(['a', 'b']) // one failure is nothing
    h.fail('a'); expect(h.usable(['a', 'b'])).toEqual(['b'])
    now = 2 * 60_000 + 1; expect(h.usable(['a', 'b'])).toEqual(['a', 'b']) // rested
    h.fail('a'); expect(h.resting('a')).toBe(true); now += 4 * 60_000 - 10; expect(h.resting('a')).toBe(true); now += 20; expect(h.resting('a')).toBe(false)
    for (let i = 0; i < 10; i++) h.fail('a'); expect(h.resting('a')).toBe(true); now += 15 * 60_000 + 1; expect(h.resting('a')).toBe(false) // never more than 15 minutes
    h.ok('a'); h.fail('a'); expect(h.resting('a')).toBe(false) // an answer resets the count
    h.fail('a'); h.fail('b'); h.fail('b'); expect(h.usable(['a', 'b'])).toEqual(['a', 'b']) // everyone resting: ask them all
  })
})

describe('collectQuick with poor coverage', () => {
  /** Relays that fail at once (no coverage, refused connection) and relays that answer later. */
  function patchy(spec: Record<string, { failAt?: number; after?: number; events?: string[] }>): Subscribe {
    return (url, _f, on) => {
      const r = spec[url]!
      const t = setTimeout(() => { if (r.failAt !== undefined) return on.oneose(true); for (const id of r.events ?? []) on.onevent(ev(id)); on.oneose() }, r.failAt ?? r.after ?? 0)
      return { close: () => clearTimeout(t) }
    }
  }
  it('relays that fail quickly do not make a "majority": it waits for the ones that work', async () => {
    vi.useFakeTimers()
    const spec = { a: { failAt: 5 }, b: { failAt: 5 }, c: { failAt: 5 }, d: { failAt: 5 }, e: { after: 800, events: ['1'] }, f: { after: 900, events: ['2'] }, g: { after: 950, events: ['3'] } }
    const p = collectQuick(patchy(spec), Object.keys(spec), { kinds: [1] }); await vi.advanceTimersByTimeAsync(1200)
    const got = await p
    expect(got.map((e) => e.id).sort()).toEqual(['1', '2', '3']) // before: four quick failures made a majority and it answered empty at 0.2 s
    expect(isPartial(got)).toBe(true); vi.useRealTimers() // three of seven answered: complete for them, but asked again later
  })
  it('an answer cut short by the wait, or given by fewer than half of the relays, is marked partial; a full one is not', async () => {
    vi.useFakeTimers()
    const cut = collectQuick(patchy({ a: { after: 10, events: ['k'] }, b: { after: 99_999 }, c: { after: 99_999 } }), ['a', 'b', 'c'], { kinds: [1] }, { maxWait: 1000 }); await vi.advanceTimersByTimeAsync(1100)
    expect(isPartial(await cut)).toBe(true)
    const few = collectQuick(patchy({ a: { after: 10, events: ['k'] }, b: { failAt: 1 }, c: { failAt: 1 } }), ['a', 'b', 'c'], { kinds: [1] }); await vi.advanceTimersByTimeAsync(300)
    expect(isPartial(await few)).toBe(true) // one relay of three: the others could not be reached
    const full = collectQuick(patchy({ a: { after: 10, events: ['k'] }, b: { after: 20 }, c: { failAt: 1 } }), ['a', 'b', 'c'], { kinds: [1] }); await vi.advanceTimersByTimeAsync(300)
    expect(isPartial(await full)).toBe(false); vi.useRealTimers()
  })
})

describe('memo: a partial answer is asked again', () => {
  it('keeps a full answer, but asks again for a partial one after emptyMs', async () => {
    let calls = 0, t = 0, partial = true
    const inner = { query: async () => { calls++; const r = [ev(`n${calls}`)]; return partial ? markPartial(r) : r } }
    const m = memo(inner, 30_000, () => t)
    await m.query({ kinds: [1] }); t = 10_000; await m.query({ kinds: [1] }); expect(calls).toBe(1) // still fresh
    partial = false; t = 31_000; expect((await m.query({ kinds: [1] }))[0]!.id).toBe('n2') // asked again
    t = 999_999; await m.query({ kinds: [1] }); expect(calls).toBe(2) // a full answer is kept
  })
})
