import { nip19 } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import { canSign, checkTemplate, MAX_NOTE_CHARS, MAX_SIGNATURES_PER_HOUR, recentSignatures, sameTags } from './policy.js'

const note = (content: string, tags: string[][] = [], kind = 1) => ({ kind, content, tags, created_at: 1_700_000_000 })
const id = 'a'.repeat(64)

describe('checkTemplate: Quill only asks for notes and reactions', () => {
  it('accepts a plain note, a reply and a reaction', () => {
    expect(checkTemplate(note('hello'))).toBeNull()
    expect(checkTemplate(note('hi', [['e', id, '', 'root'], ['p', id]]))).toBeNull()
    expect(checkTemplate(note('🦞', [['e', id], ['p', id], ['k', '1']], 7))).toBeNull()
  })
  it('refuses every other kind: deleting, follow lists, relay-list lookalikes of other kinds, DMs, profiles', () => {
    for (const kind of [0, 4, 5, 10050, 10063, 14, 30023, 22242, 24133]) expect(checkTemplate(note('x', [], kind)), String(kind)).toBe('kind')
  })
  it('refuses empty and over-long notes, counting characters', () => {
    expect(checkTemplate(note('   \n '))).toBe('empty')
    expect(checkTemplate(note('😀'.repeat(MAX_NOTE_CHARS)))).toBeNull()
    expect(checkTemplate(note('😀'.repeat(MAX_NOTE_CHARS + 1)))).toBe('too-long')
  })
  it('a reaction is + - or one emoji, and must name what it reacts to and whose it is', () => {
    expect(checkTemplate(note('nice', [['e', id], ['p', id]], 7))).toBe('reaction')
    expect(checkTemplate(note('+', [['e', id]], 7))).toBe('reaction-target')
    expect(checkTemplate(note('+', [['p', id]], 7))).toBe('reaction-target')
  })
  it('refuses odd tags: unknown names, too many values, huge values, too many tags', () => {
    expect(checkTemplate(note('x', [['delegation', id, 'x']]))).toBe('tags')
    expect(checkTemplate(note('x', [['e', id, '', 'root', 'extra']]))).toBe('tags')
    expect(checkTemplate(note('x', [['t', 'y'.repeat(301)]]))).toBe('tags')
    expect(checkTemplate(note('x', [['t']]))).toBe('tags')
    expect(checkTemplate(note('x', Array.from({ length: 41 }, (_, i) => ['t', `w${i}`])))).toBe('tags')
  })
})

describe('the hourly cap and tag comparison', () => {
  it('counts only the last hour, ignores junk and timestamps from the future', () => {
    const now = 1_700_000_000
    expect(recentSignatures([now - 10, now - 3599, now - 3600, now + 600, NaN], now)).toEqual([now - 10, now - 3599])
    expect(canSign(Array.from({ length: MAX_SIGNATURES_PER_HOUR - 1 }, () => now - 5), now)).toBe(true)
    expect(canSign(Array.from({ length: MAX_SIGNATURES_PER_HOUR }, () => now - 5), now)).toBe(false)
  })
  it('sameTags is exact, order included', () => {
    expect(sameTags([['e', id]], [['e', id]])).toBe(true)
    expect(sameTags([['e', id], ['p', id]], [['p', id], ['e', id]])).toBe(false)
    expect(sameTags([['e', id]], [['e', id, '']])).toBe(false)
  })
})

describe('quotes', () => {
  const target = 'a'.repeat(64), author = 'b'.repeat(64), hint = 'wss://relay.example.com'
  const ref = (id = target) => 'nostr:' + nip19.neventEncode({ id, relays: [hint], author })
  const quote = (over: Partial<{ content: string; tags: string[][]; kind: number }> = {}) => ({ kind: 1, content: `my comment\n\n${ref()}`, tags: [['q', target, hint, author], ['p', author]], created_at: 1, ...over })
  it('a comment, a reference to the note, and exactly one q tag for it: fine', () => {
    expect(checkTemplate(quote())).toBeNull(); expect(checkTemplate(quote({ tags: [['q', target], ['p', author]] }))).toBeNull(); expect(checkTemplate(quote({ tags: [['q', target, '', author]] }))).toBeNull()
  })
  it('refuses the shapes that are not a quote Quill builds', () => {
    const bad = (name: string, t: ReturnType<typeof quote>) => expect(checkTemplate(t), name).toBe('quote')
    bad('two q tags', quote({ tags: [['q', target, hint, author], ['q', 'c'.repeat(64)], ['p', author]] }))
    bad('the text does not reference the quoted note', quote({ content: 'my comment, no reference' }))
    bad('the reference is to another note', quote({ content: `my comment\n\n${ref('c'.repeat(64))}` }))
    bad('no comment of its own (that is a share, not a quote)', quote({ content: ref() }))
    bad('only whitespace around the reference', quote({ content: `   \n\n${ref()}   ` }))
    bad('a q tag that is not an id', quote({ tags: [['q', 'nothex', hint, author]] }))
    bad('an insecure relay hint', quote({ tags: [['q', target, 'ws://relay.example.com', author]] }))
    bad('an author that is not a key', quote({ tags: [['q', target, hint, 'zzz']] }))
    expect(checkTemplate(quote({ tags: [['q', target, hint, author, 'extra']] })), 'a q tag with extra fields').toBe('tags') // stopped by the general tag check
  })
  it('a q tag is only for notes: a reaction or a relay list never carries one', () => {
    expect(checkTemplate({ kind: 7, content: '❤️', tags: [['e', target], ['p', author], ['q', target]], created_at: 1 })).toBe('tags')
  })
  it('the usual limits still apply to the whole text, reference included', () => {
    expect(checkTemplate(quote({ content: `${'x'.repeat(990)}\n\n${ref()}` }))).toBe('too-long')
  })
})
