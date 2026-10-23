import { describe, expect, it } from 'vitest'
import type { Event, Filter } from 'nostr-tools'
import type { Fetcher, QueryOptions } from '../net/fetcher.js'
import { loadPickNotes, PICK_RELAYS } from './pick.js'

const note = (id: string, pubkey: string) => ({ id, pubkey, kind: 1, content: 'x', tags: [], created_at: 1, sig: '' }) as Event

describe('the notes of the Pick of the day', () => {
  it('asks again for the ones the quick answer missed, waiting for every relay and asking the big ones too; an author that does not match is dropped', async () => {
    const a = 'a'.repeat(64), b = 'b'.repeat(64), c = 'c'.repeat(64), k = '1'.repeat(64)
    const asked: [Filter, QueryOptions | undefined][] = []
    const f: Fetcher = { query: async (filter, o) => { asked.push([filter, o]); return o?.quick === false ? [note(b, k), note(c, 'f'.repeat(64))] : [note(a, k)] } }
    const got = await loadPickNotes(f, [{ id: a, pubkey: k, title: 'A', summary: '' }, { id: b, pubkey: k, title: 'B', summary: '' }, { id: c, pubkey: k, title: 'C', summary: '' }])
    expect([...got.keys()]).toEqual([a, b])
    expect(asked[1]![0].ids).toEqual([b, c]); expect(asked[1]![1]).toEqual({ quick: false, also: PICK_RELAYS })
  })
  it('asks once when the first answer has them all', async () => {
    const a = 'a'.repeat(64), k = '1'.repeat(64); let n = 0
    await loadPickNotes({ query: async () => { n++; return [note(a, k)] } }, [{ id: a, pubkey: k, title: 'A', summary: '' }])
    expect(n).toBe(1)
  })
})
