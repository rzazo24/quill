import { describe, expect, it } from 'vitest'
import { interestsIn } from './interests.js'

const note = (content: string, tags: string[][] = []) => ({ content, tags })
describe('topics the reader cares about', () => {
  it('match where a word starts, accents and capitals aside; a #tag of the note counts too', () => {
    expect(interestsIn(note('New RELAYS are up'), ['relay'])).toEqual(['relay'])
    expect(interestsIn(note('Mañana hablamos de Bitcóin'), ['bitcoin', 'mañana'])).toEqual(['bitcoin', 'mañana'])
    expect(interestsIn(note('nothing here', [['t', 'Hive']]), ['#hive'])).toEqual(['hive'])
    expect(interestsIn(note('a #nostr note'), ['nostr'])).toEqual(['nostr'])
  })
  it('not in the middle of another word, and nothing without topics', () => {
    expect(interestsIn(note('the correlay of things'), ['relay'])).toEqual([])
    expect(interestsIn(note('relay'), [])).toEqual([])
  })
  it('names at most three, in the reader\'s order', () => {
    expect(interestsIn(note('a b c d'), ['d', 'c', 'b', 'a'])).toEqual(['d', 'c', 'b'])
  })
})

describe('what a note talks about', () => {
  it('leaves out references and web addresses', () => {
    expect(interestsIn(note('look at this nostr:nevent1qqsabc and https://nostr.example/bitcoin'), ['nostr', 'bitcoin'])).toEqual([])
    expect(interestsIn(note('nostr is fun nostr:npub1xyz'), ['nostr'])).toEqual(['nostr'])
  })
})
