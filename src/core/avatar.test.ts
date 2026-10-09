import { describe, expect, it } from 'vitest'
import { avatarOf, initials } from './avatar.js'

const a = 'a'.repeat(64), b = 'b'.repeat(64)

describe('initials', () => {
  it('two words give two letters; one word gives its first two; case is normalised', () => {
    expect(initials('Dr. The Daniel 🖖')).toBe('DT')
    expect(initials('rizful.com (zap')).toBe('RC')
    expect(initials('manánguri')).toBe('MA')
    expect(initials('x')).toBe('X')
  })
  it('keeps an emoji or another alphabet as one character', () => {
    expect(initials('🦞 lobster')).toBe('🦞L')
    expect(initials('Ñandú Ωmega')).toBe('ÑΩ')
    expect(initials('日本語')).toBe('日本')
  })
  it('nothing usable gives an empty string', () => {
    for (const n of [undefined, '', '   ', '***', '...']) expect(initials(n as string | undefined)).toBe('')
  })
})

describe('avatarOf', () => {
  it('the colour comes from the key: stable, in range, and different for different keys', () => {
    expect(avatarOf(a).hue).toBe(avatarOf(a, 'Someone').hue)
    expect(avatarOf(a).hue).not.toBe(avatarOf(b).hue)
    for (const k of [a, b, '0'.repeat(64), 'f'.repeat(64)]) { const h = avatarOf(k).hue; expect(h).toBeGreaterThanOrEqual(0); expect(h).toBeLessThan(360) }
  })
  it('never has empty letters: without a name the key stands in', () => {
    expect(avatarOf(a).letters).toBe('AA'); expect(avatarOf(b, '').letters).toBe('BB'); expect(avatarOf(a, 'Ana Díaz').letters).toBe('AD')
  })
  it('a malformed key still gives a valid avatar', () => {
    expect(avatarOf('not hex', 'x')).toEqual({ hue: 0, letters: 'X' })
  })
})
