import { describe, expect, it } from 'vitest'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { keyIsPublic } from './publickey.js'

describe('an account that shows its own private key', () => {
  const sk = generateSecretKey(), pubkey = getPublicKey(sk), nsec = nip19.nsecEncode(sk)
  it('is spotted in any field of the profile, even in capitals', () => {
    expect(keyIsPublic(pubkey, JSON.stringify({ name: `shared ${nsec}` }))).toBe(true)
    expect(keyIsPublic(pubkey, JSON.stringify({ about: `log in with ${nsec.toUpperCase()} and post` }))).toBe(true)
  })
  it('is not confused with an nsec of another account, a broken one or none', () => {
    const other = nip19.nsecEncode(generateSecretKey())
    expect(keyIsPublic(pubkey, JSON.stringify({ about: `not mine: ${other}` }))).toBe(false)
    expect(keyIsPublic(pubkey, JSON.stringify({ name: nsec.slice(0, -1) + (nsec.endsWith('q') ? 'p' : 'q') }))).toBe(false)
    expect(keyIsPublic(pubkey, '{"name":"alice"}')).toBe(false)
    expect(keyIsPublic(pubkey, 'not json at all')).toBe(false)
  })
})
