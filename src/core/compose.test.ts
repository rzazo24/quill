import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, type Event } from 'nostr-tools'
import { hashtagTags, isReactionContent, mentionTags, mergeTags, quoteContent, quoteRef, quoteReserve, quoteTags, reactionTags, replyTags } from './compose.js'

const key = () => { const sk = generateSecretKey(); return { sk, pk: getPublicKey(sk) } }
const ev = (k: { sk: Uint8Array }, kind: number, content: string, created_at: number, tags: string[][] = []) => finalizeEvent({ kind, content, created_at, tags }, k.sk)

const NOW = 1_800_000_000
const [alice, bob, carol] = [key(), key(), key()]

describe('isReactionContent', () => {
  it('accepts + - and a single emoji; refuses words, shortcodes and several emoji separated by text', () => {
    for (const ok of ['+', '-', '❤️', '🔥', '🤙', '👍🏽', '👨‍👩‍👧']) expect(isReactionContent(ok), ok).toBe(true)
    for (const bad of ['', 'nice', ':fire:', '+1', '🔥 hot', '❤️❤️❤️ lovely']) expect(isReactionContent(bad), bad).toBe(false)
  })
})

describe('reactionTags', () => {
  it('names the event, its author and its kind', () => {
    const note = ev(alice, 1, 'hi', NOW)
    expect(reactionTags(note)).toEqual([['e', note.id], ['p', alice.pk], ['k', '1']])
  })
  it('adds the a coordinate for an addressable event', () => {
    const article = ev(alice, 30023, 'long', NOW, [['d', 'my-article']])
    expect(reactionTags(article)).toContainEqual(['a', `30023:${alice.pk}:my-article`])
  })
})

describe('replyTags (NIP-10)', () => {
  it('a reply to a root note carries only the root marker, then the author', () => {
    const root = ev(alice, 1, 'root', NOW)
    expect(replyTags(root)).toEqual([['e', root.id, '', 'root'], ['p', alice.pk]])
  })
  it('a reply deeper in a thread carries root AND reply, and the people the parent addressed, author first', () => {
    const root = ev(alice, 1, 'root', NOW)
    const mid = ev(bob, 1, 'mid', NOW, [['e', root.id, 'wss://r.example', 'root'], ['p', alice.pk]])
    expect(replyTags(mid)).toEqual([['e', root.id, 'wss://r.example', 'root'], ['e', mid.id, '', 'reply'], ['p', bob.pk], ['p', alice.pk]])
  })
  it('understands legacy positional tags (the first e is the root)', () => {
    const root = ev(alice, 1, 'root', NOW)
    const old = ev(bob, 1, 'old style', NOW, [['e', root.id], ['p', alice.pk]])
    expect(replyTags(old).slice(0, 2)).toEqual([['e', root.id, '', 'root'], ['e', old.id, '', 'reply']])
  })
  it('caps the p tags and never repeats one', () => {
    const many = ev(alice, 1, 'crowd', NOW, [...Array.from({ length: 30 }, (_, i) => ['p', String(i + 1).padStart(64, '0')]), ['p', alice.pk]])
    const ps = replyTags(many).filter((t) => t[0] === 'p')
    expect(ps).toHaveLength(8); expect(ps[0]).toEqual(['p', alice.pk]); expect(new Set(ps.map((t) => t[1])).size).toBe(8)
  })
  it('refuses to reply to anything but a note, explaining why', () => {
    expect(() => replyTags(ev(alice, 30023, 'x', NOW))).toThrow(/NIP-22/)
  })
  it('ignores malformed e and p tags', () => {
    const odd = ev(bob, 1, 'odd', NOW, [['e', 'not-hex'], ['p', 'nope']])
    expect(replyTags(odd)).toEqual([['e', odd.id, '', 'root'], ['p', bob.pk]])
  })
})

describe('hashtags and mentions', () => {
  it('hashtagTags: lower-case, deduplicated, not inside words or URLs, not pure numbers', () => {
    expect(hashtagTags('Meet #Nostr and #MCP! #nostr again, issue #12, see https://x.example/#section, a#b, #ñandú')).toEqual([['t', 'nostr'], ['t', 'mcp'], ['t', 'ñandú']])
    expect(hashtagTags(Array.from({ length: 30 }, (_, i) => `#tag${i}`).join(' '))).toHaveLength(10)
  })
  it('mentionTags: nostr:npub and nostr:nprofile become p tags; broken references are ignored', () => {
    const text = `hi nostr:${nip19.npubEncode(bob.pk)} and nostr:${nip19.nprofileEncode({ pubkey: carol.pk })} and nostr:npub1notvalidnotvalidnotvalid and nostr:${nip19.npubEncode(bob.pk)}`
    expect(mentionTags(text)).toEqual([['p', bob.pk], ['p', carol.pk]])
  })
  it('mergeTags keeps what the user asked for and adds only what is not there', () => {
    expect(mergeTags([['t', 'nostr'], ['x', '1']], [['t', 'nostr'], ['t', 'mcp']])).toEqual([['t', 'nostr'], ['x', '1'], ['t', 'mcp']])
  })
})

describe('quotes', () => {
  const target = { id: 'a'.repeat(64), pubkey: 'b'.repeat(64), kind: 1, created_at: 1, tags: [], content: 'x', sig: 'c'.repeat(128) } as Event
  it('the reference decodes back to the note, its author and where to find it; the tags point at both', () => {
    const d = nip19.decode(quoteRef(target, 'wss://relay.example.com').replace('nostr:', '')); expect(d.type).toBe('nevent')
    expect(d.data).toMatchObject({ id: target.id, author: target.pubkey, relays: ['wss://relay.example.com'], kind: 1 })
    expect(quoteTags(target, 'wss://relay.example.com')).toEqual([['q', target.id, 'wss://relay.example.com', target.pubkey], ['p', target.pubkey]])
    expect((nip19.decode(quoteRef(target, '').replace('nostr:', '')).data as { relays: string[] }).relays).toEqual([])
  })
  it('the content is the comment, a blank line and the reference; the reserve is what the reference takes', () => {
    const c = quoteContent('  my comment  ', target, ''); expect(c).toBe(`my comment\n\n${quoteRef(target, '')}`); expect([...c].length).toBe([...'my comment'].length + quoteReserve(target, ''))
  })
})
