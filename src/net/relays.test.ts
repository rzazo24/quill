import { describe, expect, it } from 'vitest'
import { addRelay, MAX_RELAYS, normalizeRelay, parseRelays, probeRelay, removeRelay } from './relays.js'

describe('normalizeRelay', () => {
  it('accepts a secure relay address, with or without the scheme, and tidies it', () => {
    for (const [i, o] of [['relay.example.com', 'wss://relay.example.com'], ['wss://Relay.Example.com/', 'wss://relay.example.com'], ['  WSS://nos.lol  ', 'wss://nos.lol'], ['wss://relay.example.com:8443/nostr/', 'wss://relay.example.com:8443/nostr']] as const) expect(normalizeRelay(i)).toBe(o)
  })
  it('refuses everything that is not a plain secure relay address', () => {
    for (const bad of ['', '   ', 'ws://relay.example.com', 'http://relay.example.com', 'https://relay.example.com', 'ftp://x.example.com', 'wss://user:pw@relay.example.com', 'wss://relay.example.com?x=1', 'wss://relay.example.com/#a',
      'localhost', 'wss://localhost', 'wss://intranet', 'wss://127.0.0.1', '192.168.1.5', 'wss://[::1]', 'wss://a b.example.com', 'wss://-bad.example.com', 'javascript:alert(1)', 'wss://' + 'a'.repeat(200) + '.com', 'wss://.example.com', 'wss://example..com']) expect(normalizeRelay(bad), bad).toBeNull()
  })
})

describe('the stored list', () => {
  it('reads a good list, drops what is invalid or repeated, keeps at most the maximum', () => {
    expect(parseRelays(JSON.stringify(['nos.lol', 'wss://nos.lol/', 'ws://bad.example.com', 42, null, 'wss://relay.example.com']))).toEqual(['wss://nos.lol', 'wss://relay.example.com'])
    expect(parseRelays(JSON.stringify(Array.from({ length: 30 }, (_, i) => `r${i}.example.com`)))).toHaveLength(MAX_RELAYS)
  })
  it('anything unusable means "use the default list" (null)', () => {
    for (const raw of [null, '', 'nonsense', '{}', '"a"', '[]', '[1,2]', JSON.stringify(['ws://x.example.com'])]) expect(parseRelays(raw), String(raw)).toBeNull()
  })
  it('add: validates, refuses repeats and a full list; remove: never the last one', () => {
    expect(addRelay(['wss://a.example.com'], 'b.example.com')).toEqual({ ok: true, list: ['wss://a.example.com', 'wss://b.example.com'] })
    expect(addRelay(['wss://a.example.com'], 'WSS://A.example.com/')).toEqual({ ok: false, why: 'duplicate' }); expect(addRelay([], 'ws://x.com')).toEqual({ ok: false, why: 'invalid' })
    expect(addRelay(Array.from({ length: MAX_RELAYS }, (_, i) => `wss://r${i}.example.com`), 'new.example.com')).toEqual({ ok: false, why: 'full' })
    expect(removeRelay(['wss://a.example.com', 'wss://b.example.com'], 'wss://a.example.com')).toEqual(['wss://b.example.com']); expect(removeRelay(['wss://a.example.com'], 'wss://a.example.com')).toEqual(['wss://a.example.com'])
  })
})

describe('probeRelay', () => {
  const fake = (behaviour: 'open' | 'error' | 'silent' | 'throw') => class { onopen?: () => void; onerror?: () => void; onclose?: () => void; closed = false
    constructor(public url: string) { if (behaviour === 'throw') throw new Error('bad'); setTimeout(() => (behaviour === 'open' ? this.onopen?.() : behaviour === 'error' ? this.onerror?.() : undefined), 5) }
    close() { this.closed = true } } as unknown as typeof WebSocket
  it('answers yes when the connection opens, no on error, on a throw and on silence', async () => {
    expect(await probeRelay('wss://a.example.com', 200, fake('open'))).toBe(true); expect(await probeRelay('wss://a.example.com', 200, fake('error'))).toBe(false)
    expect(await probeRelay('wss://a.example.com', 200, fake('throw'))).toBe(false); expect(await probeRelay('wss://a.example.com', 50, fake('silent'))).toBe(false)
  })
})
