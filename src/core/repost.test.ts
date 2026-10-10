import { finalizeEvent, generateSecretKey, type Event } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import { canRepost, checkRepost, MAX_REPOST_JSON, repostTemplate } from './repost.js'
import { checkTemplate, ALLOWED_KINDS } from '../sign/policy.js'

const note = (content = 'a note worth sharing', kind = 1, tags: string[][] = []): Event => finalizeEvent({ kind, created_at: 1_700_000_000, tags, content }, generateSecretKey())
const hint = 'wss://relay.example.com'

describe('what a repost is', () => {
  it('Quill builds exactly: the copy of the note as its content, and the pointer (e with a relay hint, p with the author)', () => {
    const n = note(), t = repostTemplate(n, hint, 5)
    expect(t).toEqual({ kind: 6, content: JSON.stringify(n), tags: [['e', n.id, hint], ['p', n.pubkey]], created_at: 5 })
    expect(checkRepost(t)).toBeNull(); expect(checkTemplate(t)).toBeNull(); expect(ALLOWED_KINDS).toContain(6)
    expect(checkRepost(repostTemplate(n, '', 5))).toBeNull() // an empty hint is allowed
  })
  it('only text notes whose copy is not too big can be shared', () => {
    expect(canRepost(note())).toBe(true); expect(canRepost(note('x', 30023))).toBe(false); expect(canRepost(note('x'.repeat(MAX_REPOST_JSON)))).toBe(false)
  })
})

describe('everything else is refused', () => {
  const n = note('original text'), good = () => repostTemplate(n, hint, 5)
  const bad = (name: string, t: ReturnType<typeof good>, why: 'repost' | 'repost-too-long' = 'repost') => it(name, () => { expect(checkRepost(t), name).toBe(why); expect(checkTemplate(t), name).toBe(why) })
  bad('the copy was tampered with after it was signed', { ...good(), content: JSON.stringify({ ...n, content: 'changed' }) })
  bad('the copy has an invalid signature', { ...good(), content: JSON.stringify({ ...n, sig: '0'.repeat(128) }) })
  bad('the copy has an id that is not the hash of the note', { ...good(), content: JSON.stringify({ ...n, id: 'a'.repeat(64) }), tags: [['e', 'a'.repeat(64), hint], ['p', n.pubkey]] })
  bad('the copy carries an extra field', { ...good(), content: JSON.stringify({ ...n, extra: 'smuggled' }) })
  bad('the copy is padded with whitespace', { ...good(), content: ` ${JSON.stringify(n)}` })
  bad('the content is not JSON', { ...good(), content: 'just text' })
  bad('the content is empty (a reaction-like repost)', { ...good(), content: '' })
  bad('the copy is not a text note', (() => { const a = note('x', 30023); return repostTemplate(a, hint, 5) })())
  bad('the e tag points at another note', { ...good(), tags: [['e', 'b'.repeat(64), hint], ['p', n.pubkey]] })
  bad('the p tag names somebody else', { ...good(), tags: [['e', n.id, hint], ['p', 'c'.repeat(64)]] })
  bad('an extra tag', { ...good(), tags: [...good().tags, ['t', 'spam']] })
  bad('a missing tag', { ...good(), tags: [['e', n.id, hint]] })
  bad('the tags in the wrong order', { ...good(), tags: [['p', n.pubkey], ['e', n.id, hint]] })
  bad('an insecure relay hint', { ...good(), tags: [['e', n.id, 'ws://relay.example.com'], ['p', n.pubkey]] })
  bad('an untidy relay hint', { ...good(), tags: [['e', n.id, 'wss://Relay.Example.com/'], ['p', n.pubkey]] })
  bad('a hint with more fields', { ...good(), tags: [['e', n.id, hint, 'extra'], ['p', n.pubkey]] })
  bad('a copy that is too big', { ...good(), content: JSON.stringify(note('x'.repeat(MAX_REPOST_JSON))) }, 'repost-too-long')
  it('other kinds are still refused (the repost kind is the only new one, and the generic repost 16 is not)', () => { for (const kind of [5, 16, 3, 4, 30023]) expect(checkTemplate({ kind, content: JSON.stringify(n), tags: good().tags, created_at: 1 }), String(kind)).toBe('kind') })
})
