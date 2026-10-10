import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import { followChange, followPubkeys, followTemplate, MAX_FOLLOW_TAGS } from './follow.js'
import { checkTemplate } from '../sign/policy.js'

const sk = generateSecretKey(), me = getPublicKey(sk)
const key = (n: number) => ('f' + n.toString(16).padStart(3, '0')).repeat(16)
const list = (tags: string[][], content = '', at = 1000): Event => finalizeEvent({ kind: 3, created_at: at, tags, content }, sk)
const tags5 = (): string[][] => [['p', key(1)], ['p', key(2), 'wss://relay.example.com', 'Bruno'], ['t', 'nostr'], ['p', key(3)], ['p', key(4), '']]
const base = () => list(tags5(), '{"wss://old.example":{"read":true}}')

describe('building the next list', () => {
  it('follow: the base list as it is, one p tag at the end; unfollow: all the p tags of that account gone, nothing else touched; the old content and every hint kept', () => {
    const b = base(), f = followTemplate(b, key(9), 'follow', 5000)!
    expect(f.tags).toEqual([...tags5(), ['p', key(9)]]); expect(f.content).toBe(b.content); expect(f.kind).toBe(3); expect(f.created_at).toBe(5000)
    const u = followTemplate(b, key(2), 'unfollow', 5000)!; expect(u.tags).toEqual([['p', key(1)], ['t', 'nostr'], ['p', key(3)], ['p', key(4), '']]); expect(u.content).toBe(b.content)
    expect(followTemplate(b, key(2), 'unfollow', 5000)!.tags).not.toContainEqual(['p', key(2), 'wss://relay.example.com', 'Bruno'])
  })
  it('the new list is always newer than the one it replaces, even with a clock that is behind', () => { expect(followTemplate(base(), key(9), 'follow', 5)!.created_at).toBe(1001) })
  it('nothing to do (already followed, not followed), not an account, yourself, or a list too big: null', () => {
    const b = base()
    expect(followTemplate(b, key(1), 'follow', 5000)).toBeNull(); expect(followTemplate(b, key(9), 'unfollow', 5000)).toBeNull(); expect(followTemplate(b, 'nothex', 'follow', 5000)).toBeNull(); expect(followTemplate(b, me, 'follow', 5000)).toBeNull()
    expect(followTemplate(list(Array.from({ length: MAX_FOLLOW_TAGS }, (_, i) => ['p', key(i + 10)])), key(9), 'follow', 5000)).toBeNull()
    expect(followTemplate({ ...b, kind: 1 } as Event, key(9), 'follow', 5000)).toBeNull()
  })
  it('lists the accounts of a list once each, in order', () => { expect(followPubkeys(list([...tags5(), ['p', key(1)], ['p', 'junk']]))).toEqual([key(1), key(2), key(3), key(4)]) })
})

describe('what a change is', () => {
  const b = base(), at = 5000
  it('recognises exactly what Quill builds, both ways', () => {
    expect(followChange(b, followTemplate(b, key(9), 'follow', at)!)).toEqual({ action: 'follow', pubkey: key(9) }); expect(followChange(b, followTemplate(b, key(2), 'unfollow', at)!)).toEqual({ action: 'unfollow', pubkey: key(2) })
    expect(followChange(b, followTemplate(b, key(1), 'unfollow', at)!)).toEqual({ action: 'unfollow', pubkey: key(1) }) // the first of the list
  })
  const good = () => followTemplate(b, key(9), 'follow', at)!
  const no = (name: string, t: ReturnType<typeof good>) => it(`refuses: ${name}`, () => { expect(followChange(b, t), name).toBeNull() })
  no('a different content', { ...good(), content: 'changed' })
  no('not newer than the base', { ...good(), created_at: 1000 })
  no('older than the base', { ...good(), created_at: 10 })
  no('two accounts added', { ...good(), tags: [...good().tags, ['p', key(10)]] })
  no('an account added in the middle, not at the end', { ...good(), tags: [...tags5().slice(0, 2), ['p', key(9)], ...tags5().slice(2)] })
  no('an added tag with a hint', { ...good(), tags: [...tags5(), ['p', key(9), 'wss://x.example']] })
  no('something else added (a t tag)', { ...good(), tags: [...tags5(), ['t', 'x']] })
  no('the reader themself added', { ...good(), tags: [...tags5(), ['p', me]] })
  no('an account that is already followed added again', { ...good(), tags: [...tags5(), ['p', key(1)]] })
  no('a tag changed while one is added', { ...good(), tags: [['p', key(1)], ['p', key(2)], ['t', 'nostr'], ['p', key(3)], ['p', key(4), ''], ['p', key(9)]] })
  no('two accounts removed', { ...good(), tags: [['p', key(1)], ['p', key(4), '']] })
  no('an account removed AND one added (same size)', { ...good(), tags: [['p', key(1)], ['t', 'nostr'], ['p', key(3)], ['p', key(4), ''], ['p', key(9)]] })
  no('the list emptied', { ...good(), tags: [] })
  no('a t tag removed', { ...good(), tags: [['p', key(1)], ['p', key(2), 'wss://relay.example.com', 'Bruno'], ['p', key(3)], ['p', key(4), '']] })
  no('tags reordered', { ...good(), tags: [...tags5().reverse(), ['p', key(9)]].slice(0, 6) })
  no('tags that are not strings', { ...good(), tags: [...tags5(), [1 as unknown as string, 2 as unknown as string]] })
  it('refuses a template of another kind, and a base that is not a follow list', () => {
    expect(followChange(b, { ...good(), kind: 1 })).toBeNull(); expect(followChange({ ...b, kind: 1 } as Event, good())).toBeNull()
  })
})

describe('the policy for kind 3', () => {
  const b = base()
  it('without the list it was built from, nothing is signed; with it, exactly one account more or less', () => {
    const t = followTemplate(b, key(9), 'follow', 5000)!
    expect(checkTemplate(t)).toBe('follow'); expect(checkTemplate(t, { followBase: b })).toBeNull(); expect(checkTemplate(followTemplate(b, key(2), 'unfollow', 5000)!, { followBase: b })).toBeNull()
    expect(checkTemplate({ ...t, tags: [] }, { followBase: b })).toBe('follow') // wiping the list
    expect(checkTemplate({ ...t, tags: t.tags.slice(0, 2) }, { followBase: b })).toBe('follow') // dropping most of it
    expect(checkTemplate(t, { followBase: base() })).toBeNull() // the same base, rebuilt: fine
    expect(checkTemplate(t, { followBase: list([['p', key(1)]]) })).toBe('follow') // built from another list: no
  })
})
