import { describe, expect, it } from 'vitest'
import type { Event } from 'nostr-tools'
import { ev, pk } from './testutil.js'
import { zapHistory } from './zaphistory.js'

const me = pk('1'), ana = pk('a'), bob = pk('b'), note = 'e'.repeat(64)
const ok = (e: Event) => e.sig !== 'bad'
const req = (from: string, to: string, msats: number, content = '', over: Partial<Event> = {}) => ev(from, content, { kind: 9734, tags: [['p', to], ['amount', String(msats)], ['e', note]], ...over })
const receipt = (to: string, r: Event | null, bolt11 = 'lnbc210n1xyz', at = 100) => ev(pk('9'), '', { kind: 9735, created_at: at, tags: [['p', to], ['e', note], ['bolt11', bolt11], ...(r ? [['description', JSON.stringify(r)]] : [])] })

describe('zap history', () => {
  it('received zaps name a provable sender; sent ones name who got them; newest first', () => {
    const got = receipt(me, req(ana, me, 21000, 'nice'), 'lnbc210n1xyz', 200)
    const sent = receipt(bob, req(me, bob, 21000, 'thanks'), 'lnbc210n1xyz', 300)
    const h = zapHistory([got, sent], me, ok)
    expect(h.map((x) => [x.dir, x.other, x.sats, x.comment])).toEqual([['out', bob, 21, 'thanks'], ['in', ana, 21, 'nice']])
  })
  it('a receipt whose request does not hold up: received counts with no name, sent is left out; unrelated receipts are ignored', () => {
    const forged = receipt(me, req(ana, me, 21000, '', { sig: 'bad' }))
    const wrongAmount = receipt(bob, req(me, bob, 999000), 'lnbc210n1xyz', 150)
    const others = receipt(bob, req(ana, bob, 21000))
    const anon = receipt(me, req(ana, me, 21000, '', { tags: [['p', me], ['amount', '21000'], ['anon', '']] }), 'lnbc210n1xyz', 120)
    const h = zapHistory([forged, wrongAmount, others, anon], me, ok)
    expect(h.map((x) => [x.dir, x.other])).toEqual([['in', null], ['in', null]])
  })
  it('keeps at most twenty, once each', () => {
    const many = Array.from({ length: 30 }, (_, i) => receipt(me, req(ana, me, 21000), 'lnbc210n1xyz', 1000 + i))
    expect(zapHistory([...many, many[0]!], me, ok)).toHaveLength(20)
  })
})
