import { describe, expect, it } from 'vitest'
import { ev, pk } from './testutil.js'
import { analyse, DEFAULT_SETTINGS, judge, judgeAll, mentionsWord, tally, type Context, type Graph, type Settings } from './verdict.js'

const me = pk('1'), friend = pk('2'), stranger = pk('3'), other = pk('4'), third = pk('5')
const noGraph: Graph = { loaded: false, distance: () => null }
const graphOf = (d: Record<string, number>): Graph => ({ loaded: true, distance: (k) => d[k] ?? null })
const ctx = (over: Partial<Context> = {}): Context => ({ me, follows: new Set([friend]), muted: new Set(), mutedWords: [], graph: noGraph, ...over })
const SPAM = 'Claim your free sats now at the link below'

describe('who is never hidden by behaviour', () => {
  it('your own notes and the people you follow, even if they repeat text, burst or only post links', () => {
    const burst = Array.from({ length: 8 }, (_, i) => ev(friend, `${SPAM} https://x.example/${i}`, { created_at: 1000 + i }))
    const copies = [ev(other, SPAM), ev(me, SPAM)]
    const all = [...burst, ...copies]
    const j = judgeAll(all, ctx({ graph: graphOf({}) }))
    for (const x of j.filter((x) => x.event.pubkey === friend)) expect(x.verdict).toMatchObject({ hidden: false, rule: 'followed' })
    expect(j.find((x) => x.event.pubkey === me)!.verdict).toMatchObject({ hidden: false, rule: 'own' })
  })
  it('but your own mute wins over a follow', () => {
    const e = ev(friend, 'hello there friend')
    expect(judge(e, ctx({ muted: new Set([friend]) }), analyse([e]))).toMatchObject({ hidden: true, rule: 'muted-author' })
  })
})

describe('muted words', () => {
  it('whole words, any case, any alphabet', () => {
    expect(mentionsWord('Buy BITCOIN today', 'bitcoin')).toBe(true)
    expect(mentionsWord('bitcoiner', 'bitcoin')).toBe(false) // not a whole word
    expect(mentionsWord('ñandú, ñandú!', 'ñandú')).toBe(true)
    expect(mentionsWord('a.b', 'a.b')).toBe(true)
    expect(mentionsWord('axb', 'a.b')).toBe(false) // no regex injection
    expect(mentionsWord('anything', '   ')).toBe(false)
  })
  it('hides a stranger and says which word', () => {
    const e = ev(stranger, 'giveaway time')
    expect(judge(e, ctx({ mutedWords: ['giveaway'] }), analyse([e]))).toEqual({ hidden: true, rule: 'muted-word', params: { word: 'giveaway' } })
  })
})

describe('behaviour rules', () => {
  it('repeated text: needs a distinctive text posted by other keys and most of the author\'s texts being copies', () => {
    const batch = [ev(stranger, SPAM), ev(other, SPAM), ev(third, SPAM + '!!')]
    const j = judgeAll(batch, ctx())
    // each author has a single text, so "most of their texts are copies" needs total >= 2: nothing is hidden on a one-off
    expect(j.every((x) => !x.verdict.hidden)).toBe(true)
    const more = [...batch, ev(stranger, SPAM + ' 2'), ev(other, SPAM + ' 3')]
    const j2 = judgeAll(more, ctx())
    expect(j2.find((x) => x.event.pubkey === stranger)!.verdict).toMatchObject({ hidden: true, rule: 'repeated-text', params: { shared: 2, total: 2 } })
  })
  it('greetings repeated by many keys are not spam', () => {
    const batch = ['a', 'b', 'c', 'd'].flatMap((c) => [ev(pk(c), 'gm'), ev(pk(c), 'gm everyone')])
    expect(judgeAll(batch, ctx()).every((x) => !x.verdict.hidden)).toBe(true)
  })
  it('a quote of a note from another key does not make an author a copier when most of their notes are their own', () => {
    const batch = [ev(stranger, SPAM), ev(stranger, 'an original thought about relays'), ev(stranger, 'another original thought here'), ev(other, SPAM)]
    expect(judgeAll(batch, ctx()).every((x) => !x.verdict.hidden)).toBe(true)
  })
  it('burst: 5 or more events inside a minute', () => {
    const batch = Array.from({ length: 5 }, (_, i) => ev(stranger, `different words number ${'x'.repeat(i + 1)}`, { created_at: 5000 + i * 10 }))
    expect(judge(batch[0]!, ctx(), analyse(batch))).toEqual({ hidden: true, rule: 'burst', params: { events: 5, seconds: 40 } })
    const slow = Array.from({ length: 5 }, (_, i) => ev(stranger, `slow note ${'y'.repeat(i + 1)}`, { created_at: 5000 + i * 100 }))
    expect(judgeAll(slow, ctx()).every((x) => !x.verdict.hidden)).toBe(true)
  })
  it('link-only: three or more texts and almost all with links', () => {
    const batch = [1, 2, 3, 4, 5].map((i) => ev(stranger, `look at https://x.example/${i}`, { created_at: 100 + i * 1000 }))
    expect(judge(batch[0]!, ctx(), analyse(batch))).toMatchObject({ hidden: true, rule: 'link-only', params: { withLink: 5, total: 5 } })
    const two = batch.slice(0, 2)
    expect(judgeAll(two, ctx()).every((x) => !x.verdict.hidden)).toBe(true)
  })
  it('each rule can be switched off', () => {
    const batch = Array.from({ length: 5 }, (_, i) => ev(stranger, `different words number ${'x'.repeat(i + 1)}`, { created_at: 5000 + i }))
    const off: Settings = { ...DEFAULT_SETTINGS, rules: { ...DEFAULT_SETTINGS.rules, burst: false } }
    expect(judgeAll(batch, ctx(), off).every((x) => !x.verdict.hidden)).toBe(true)
  })
})

describe('outside your network', () => {
  const e = ev(stranger, 'a note from someone far away')
  it('a graph that has not loaded hides nothing: absence of data is not evidence', () => {
    expect(judge(e, ctx({ graph: noGraph }), analyse([e]))).toMatchObject({ hidden: false, rule: 'default' })
  })
  it('hides what is further than maxDistance, or unreachable, and says how far', () => {
    expect(judge(e, ctx({ graph: graphOf({ [stranger]: 3 }) }), analyse([e]))).toEqual({ hidden: true, rule: 'outside-network', params: { max: 2, hops: 3 } })
    expect(judge(e, ctx({ graph: graphOf({}) }), analyse([e]))).toMatchObject({ hidden: true, params: { hops: 'none' } })
    expect(judge(e, ctx({ graph: graphOf({ [stranger]: 2 }) }), analyse([e]))).toMatchObject({ hidden: false })
  })
  it('maxDistance 1 keeps only the people you follow', () => {
    const s: Settings = { ...DEFAULT_SETTINGS, maxDistance: 1 }
    expect(judge(e, ctx({ graph: graphOf({ [stranger]: 2 }) }), analyse([e]), s)).toMatchObject({ hidden: true })
  })
  it('behaviour is reported before distance when both apply', () => {
    const batch = Array.from({ length: 5 }, (_, i) => ev(stranger, `different words number ${'x'.repeat(i + 1)}`, { created_at: 5000 + i }))
    expect(judge(batch[0]!, ctx({ graph: graphOf({}) }), analyse(batch)).rule).toBe('burst')
  })
})

describe('tally', () => {
  it('counts what the filter did, by rule', () => {
    const batch = [ev(friend, 'one two three'), ev(stranger, 'far away note'), ev(other, 'also far away')]
    const t = tally(judgeAll(batch, ctx({ graph: graphOf({}) })))
    expect(t).toEqual({ shown: 1, hidden: 2, byRule: { 'outside-network': 2 } })
  })
})
