import { describe, expect, it } from 'vitest'
import { isReply, threadRefs } from './thread.js'

const a = 'a'.repeat(64), b = 'b'.repeat(64), c = 'c'.repeat(64), p = 'd'.repeat(64)

describe('threadRefs', () => {
  it('reads marked tags', () => {
    expect(threadRefs({ tags: [['e', a, '', 'root'], ['e', b, '', 'reply'], ['p', p]] })).toEqual({ root: a, reply: b, people: [p] })
  })
  it('a reply marked only "root" answers the root', () => {
    expect(threadRefs({ tags: [['e', a, '', 'root']] })).toMatchObject({ root: a, reply: a })
  })
  it('old unmarked tags: first is the root, last the reply', () => {
    expect(threadRefs({ tags: [['e', a], ['e', b], ['e', c]] })).toMatchObject({ root: a, reply: c })
    expect(threadRefs({ tags: [['e', a]] })).toMatchObject({ root: a, reply: a })
  })
  it('mentions are not part of the thread', () => {
    expect(threadRefs({ tags: [['e', a, '', 'mention']] })).toEqual({ people: [] })
    expect(isReply({ tags: [['e', a, '', 'mention']] })).toBe(false)
  })
  it('ignores malformed ids and repeats', () => {
    expect(threadRefs({ tags: [['e', 'nothex'], ['p', 'x'], ['p', p], ['p', p]] })).toEqual({ people: [p] })
    expect(isReply({ tags: [] })).toBe(false)
  })
})
