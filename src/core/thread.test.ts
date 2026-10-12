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

describe('NIP-22 comments (kind 1111)', () => {
  const root = 'a'.repeat(64), parent = 'b'.repeat(64), author = 'c'.repeat(64), other = 'd'.repeat(64)
  it('the root is the upper-case E, the note it answers the lower-case e; both p and P are people', async () => {
    const { threadRefs, isReply } = await import('./thread.js')
    const c = { kind: 1111, tags: [['E', root, '', author], ['K', '1'], ['P', author], ['e', parent, '', other], ['k', '1111'], ['p', other]] }
    expect(threadRefs(c)).toEqual({ root, reply: parent, people: [author, other] })
    const first = { kind: 1111, tags: [['E', root], ['K', '1'], ['e', root], ['k', '1'], ['p', author]] }
    expect(threadRefs(first)).toMatchObject({ root, reply: root }); expect(isReply(first)).toBe(true)
  })
  it('a comment on something that is not a note is still a reply, never a root note of a feed', async () => {
    const { isReply } = await import('./thread.js')
    expect(isReply({ kind: 1111, tags: [['A', '30023:x:y'], ['K', '30023'], ['a', '30023:x:y'], ['k', '30023']] })).toBe(true)
  })
})
