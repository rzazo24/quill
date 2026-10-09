import { describe, expect, it } from 'vitest'
import { detectEnv, installHint } from './install.js'

describe('install hint', () => {
  it('only on iOS and only until it is installed', () => {
    expect(installHint({ ios: true, standalone: false })).toBe('ios')
    expect(installHint({ ios: true, standalone: true })).toBeNull()
    expect(installHint({ ios: false, standalone: false })).toBeNull()
    expect(installHint({ ios: false, standalone: true })).toBeNull()
  })
  it('detects iPhone, iPad (also when it claims to be a Mac), and the installed state', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'
    expect(detectEnv({ userAgent: iphone }, false)).toEqual({ ios: true, standalone: false })
    expect(detectEnv({ userAgent: iphone, standalone: true }, false)).toEqual({ ios: true, standalone: true })
    expect(detectEnv({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 }, false).ios).toBe(true) // iPadOS
    expect(detectEnv({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 }, false).ios).toBe(false) // a real Mac
    expect(detectEnv({ userAgent: 'Mozilla/5.0 (X11; Linux)' }, true)).toEqual({ ios: false, standalone: true })
    expect(detectEnv({}, false)).toEqual({ ios: false, standalone: false })
  })
})
