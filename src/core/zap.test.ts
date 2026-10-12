import { describe, expect, it } from 'vitest'
import { formatSats, invoiceSats, readZap } from './zap.js'

const note = 'a'.repeat(64), sender = 'b'.repeat(64)
const request = (over: Record<string, unknown> = {}) => ({ kind: 9734, pubkey: sender, id: 'r'.repeat(64), sig: '', created_at: 1, content: '', tags: [['e', note], ['p', 'c'.repeat(64)], ['amount', '21000']], ...over })
const receipt = (bolt11: string, req: unknown = request()) => ({ kind: 9735, pubkey: 'f'.repeat(64), id: 'd'.repeat(64), sig: '', created_at: 2, content: '', tags: [['e', note], ['p', 'c'.repeat(64)], ['bolt11', bolt11], ['description', JSON.stringify(req)]] })
const ok = () => true

describe('zaps', () => {
  it('reads the amount of an invoice from its prefix', () => {
    expect(invoiceSats('lnbc210n1pjxyz')).toBe(21); expect(invoiceSats('lnbc10u1abc')).toBe(1000); expect(invoiceSats('lnbc1m1abc')).toBe(100000); expect(invoiceSats('lnbc21000n1x')).toBe(2100)
    expect(invoiceSats('lnbc1pnoamount')).toBeNull(); expect(invoiceSats('nonsense')).toBeNull()
  })
  it('names the sender only when the request inside is validly signed, for the same note and the same amount', () => {
    expect(readZap(receipt('lnbc210n1x') as never, ok)).toEqual({ target: note, sats: 21, sender })
    expect(readZap(receipt('lnbc210n1x') as never, () => false)).toEqual({ target: note, sats: 21, sender: null }) // bad signature: counts, no name
    expect(readZap(receipt('lnbc210n1x', request({ tags: [['e', 'e'.repeat(64)], ['amount', '21000']] })) as never, ok)!.sender).toBeNull() // another note
    expect(readZap(receipt('lnbc10u1x') as never, ok)!.sender).toBeNull() // asked 21, paid 1000: not the same zap
    expect(readZap(receipt('lnbc210n1x', request({ tags: [['e', note], ['amount', '21000'], ['anon', '']] })) as never, ok)!.sender).toBeNull() // anonymous
    expect(readZap({ ...receipt('lnbc1pnoamount'), tags: [['e', note]] } as never, ok)).toBeNull()
  })
  it('formats sats', () => { expect(formatSats(21, 'en')).toBe('21'); expect(formatSats(2100, 'es')).toBe('2100'); expect(formatSats(21000, 'en')).toBe('21k'); expect(formatSats(2_100_000, 'en')).toBe('2.1M') })
})
