import { describe, expect, it } from 'vitest'
import { halloweenOn, inHalloweenSeason, parseTheme } from './store.js'

describe('the Halloween theme: choice and season', () => {
  const day = (m: number, d: number) => new Date(2026, m - 1, d, 12)
  it('is in season from 24 October to 1 November, and not a day outside', () => {
    expect([day(10, 23), day(10, 24), day(10, 31), day(11, 1), day(11, 2), day(1, 15), day(7, 4)].map(inHalloweenSeason)).toEqual([false, true, true, true, false, false, false])
  })
  it('an explicit choice always wins over the season; without one the season decides', () => {
    expect(halloweenOn(null, day(10, 28))).toBe(true); expect(halloweenOn(null, day(3, 3))).toBe(false)
    expect(halloweenOn('default', day(10, 28))).toBe(false); expect(halloweenOn('halloween', day(3, 3))).toBe(true)
  })
  it('reads only what it knows from storage', () => {
    expect([parseTheme('halloween'), parseTheme('default'), parseTheme(null), parseTheme('x'), parseTheme('')]).toEqual(['halloween', 'default', null, null, null])
  })
})
