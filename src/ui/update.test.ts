import { describe, expect, it } from 'vitest'
import { isNewer } from './update.js'

describe('isNewer', () => {
  it('a different build id means an update', () => {
    expect(isNewer({ build: 'mgk2p3x1' }, 'abcd1234')).toBe(true)
  })
  it('the same build, or no news, does not', () => {
    expect(isNewer({ build: 'abcd1234' }, 'abcd1234')).toBe(false)
    for (const bad of [null, undefined, {}, { build: 5 }, { build: '' }, { build: 'x' }, 'text', [], { build: 'has space' }, { build: 'a'.repeat(50) }, { build: '<script>' }]) expect(isNewer(bad, 'abcd1234'), JSON.stringify(bad)).toBe(false)
  })
  it('a development build never asks (there is nothing to update to)', () => {
    expect(isNewer({ build: 'mgk2p3x1' }, 'dev')).toBe(false); expect(isNewer({ build: 'mgk2p3x1' }, '')).toBe(false)
  })
})
