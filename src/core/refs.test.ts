import { nip19 } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import { mentionedKeys, refs, shortNpub } from './refs.js'

const pk = 'a'.repeat(64), id = 'b'.repeat(64)
const npub = nip19.npubEncode(pk), nprofile = nip19.nprofileEncode({ pubkey: pk, relays: ['wss://relay.example.net'] })
const note = nip19.noteEncode(id), nevent = nip19.neventEncode({ id, relays: [] })

describe('refs', () => {
  it('finds people and notes, keeping the text between', () => {
    expect(refs(`hi nostr:${npub} see nostr:${nevent}!`)).toEqual([
      { type: 'text', value: 'hi ' }, { type: 'person', value: npub, pubkey: pk }, { type: 'text', value: ' see ' }, { type: 'note', value: nevent, id }, { type: 'text', value: '!' },
    ])
    expect(refs(`nostr:${nprofile}`)).toEqual([{ type: 'person', value: nprofile, pubkey: pk }])
    expect(refs(`nostr:${note}`)).toEqual([{ type: 'note', value: note, id }])
  })
  it('a malformed reference stays plain text and nothing throws', () => {
    for (const bad of ['nostr:npub1' + 'q'.repeat(58), 'nostr:nprofile1qqq', 'nostr:nevent1xyz', 'nostr:nsec1abc', 'nostr:']) expect(refs(bad)).toEqual([{ type: 'text', value: bad }])
    expect(refs('')).toEqual([])
  })
  it('lists mentioned keys and shortens an npub', () => {
    expect(mentionedKeys(`nostr:${npub} and nostr:${nprofile}`)).toEqual([pk, pk])
    expect(shortNpub(pk)).toMatch(/^npub1[a-z0-9]{4}…[a-z0-9]{4}$/)
  })
})

describe('where a quoted note can be found', () => {
  it('a nevent keeps its relay hints, tidied (secure addresses only, at most 3)', async () => {
    const { refs } = await import('./refs.js')
    const { nip19 } = await import('nostr-tools')
    const id = 'e'.repeat(64)
    const [part] = refs(`nostr:${nip19.neventEncode({ id, relays: ['wss://Relay.Ditto.pub/', 'ws://insecure.example', 'wss://a.example', 'wss://b.example', 'wss://c.example'] })}`)
    expect(part).toMatchObject({ type: 'note', id, relays: ['wss://relay.ditto.pub', 'wss://a.example', 'wss://b.example'] })
  })
})

describe('a reference to a long-form article', () => {
  it('a naddr of kind 30023 is an article (author, identifier, tidy relay hints); other kinds stay text', async () => {
    const { refs } = await import('./refs.js')
    const { nip19 } = await import('nostr-tools')
    const naddr = nip19.naddrEncode({ kind: 30023, pubkey: 'a'.repeat(64), identifier: 'my-post', relays: ['wss://Relay.Example/'] })
    expect(refs(`read nostr:${naddr}`)[1]).toEqual({ type: 'article', value: naddr, naddr, pubkey: 'a'.repeat(64), identifier: 'my-post', relays: ['wss://relay.example'] })
    const other = nip19.naddrEncode({ kind: 30078, pubkey: 'a'.repeat(64), identifier: 'x' })
    expect(refs(`nostr:${other}`)).toEqual([{ type: 'text', value: `nostr:${other}` }])
  })
})
