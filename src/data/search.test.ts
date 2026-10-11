import { describe, expect, it } from 'vitest'
import { nip19 } from 'nostr-tools'
import { ev, pk } from '../core/testutil.js'
import { judgeAll, type Context } from '../core/verdict.js'
import { fold, matchNotes, matchPeople, parseTarget } from './search.js'

const ctx: Context = { me: pk('1'), follows: new Set([pk('a')]), muted: new Set([pk('m')]), mutedWords: [], graph: { loaded: true, distance: (k) => (k === pk('a') ? 1 : k === pk('b') ? 2 : null) } }

describe('search', () => {
  it('folds case and accents', () => { expect(fold('  Ágora  NOSTR ')).toBe('agora nostr') })
  it('a pasted npub, nprofile, note or nevent opens what it names; other text is searched', () => {
    expect(parseTarget(nip19.npubEncode(pk('a')))).toEqual({ kind: 'user', pubkey: pk('a') })
    expect(parseTarget('nostr:' + nip19.noteEncode('e'.repeat(64)))).toEqual({ kind: 'note', id: 'e'.repeat(64) })
    expect(parseTarget(nip19.neventEncode({ id: 'd'.repeat(64) }))).toEqual({ kind: 'note', id: 'd'.repeat(64) })
    expect(parseTarget('npub is a word')).toBeNull(); expect(parseTarget('hello')).toBeNull()
  })
  it('notes with every word, accents ignored, #tag also by the t tag, newest first', () => {
    const notes = judgeAll([ev(pk('a'), 'Café con leche y Nostr', { created_at: 1 }), ev(pk('a'), 'nostr y cafe otra vez', { created_at: 5 }), ev(pk('a'), 'solo cafe', { created_at: 3 }), ev(pk('a'), 'tagged', { created_at: 4, tags: [['t', 'Bitcoin']] })], ctx)
    expect(matchNotes(notes, 'CAFE nostr').map((j) => j.event.created_at)).toEqual([5, 1])
    expect(matchNotes(notes, '#bitcoin').map((j) => j.event.content)).toEqual(['tagged'])
    expect(matchNotes(notes, '   ')).toEqual([])
  })
  it('people by name, follows first then the network; never you or muted accounts', () => {
    const names = new Map([[pk('c'), 'Ana Stranger'], [pk('b'), 'Ana Network'], [pk('a'), 'Ana Friend'], [pk('m'), 'Ana Muted'], [pk('1'), 'Ana Me']])
    expect(matchPeople(names, '@ana', ctx).map((p) => [p.name, p.relation])).toEqual([['Ana Friend', 'follow'], ['Ana Network', 'network'], ['Ana Stranger', 'none']])
  })
})

describe('tag search', () => {
  it('a search that is one #tag gives the tag; anything else does not', async () => {
    const { tagOf } = await import('./search.js')
    expect(tagOf(' #Nostr ')).toBe('nostr'); expect(tagOf('#café')).toBe('café'); expect(tagOf('#nostr bitcoin')).toBeNull(); expect(tagOf('nostr')).toBeNull(); expect(tagOf('#')).toBeNull()
  })
})
