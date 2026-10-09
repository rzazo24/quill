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
