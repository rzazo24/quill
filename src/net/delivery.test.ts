import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, type Event } from 'nostr-tools'
import { Delivery, DELAYS } from './delivery.js'

function setup(holders: Record<string, Set<string>>) {
  const mem = new Map<string, string>(), kv = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v) }, removeItem: (k: string) => { mem.delete(k) } }
  let t = 1_000_000
  const sent: { relays: string[]; id: string }[] = []
  const d = new Delivery({
    kv, now: () => t,
    fetcher: { async query(f, o) { const r = o!.only![0]!; return [...(holders[r] ?? [])].filter((id) => f.ids!.includes(id)).map((id) => ({ id } as Event)) } },
    publisher: { async publish(e, relays) { sent.push({ relays: relays!, id: e.id }); for (const r of relays!) if (r !== 'wss://never') (holders[r] ??= new Set()).add(e.id); return Object.fromEntries(relays!.map((r) => [r, 'ok'])) } },
  })
  return { d, sent, advance: (ms: number) => { t += ms }, pending: () => d.pending() }
}
const note = () => finalizeEvent({ kind: 1, content: 'x', tags: [], created_at: 1 }, generateSecretKey())

describe('checking that a published event really is on the relays', () => {
  it('looks a little later; relays that have it are done, one that lost it gets the same event again, and is checked again after', async () => {
    const e = note()
    const s = setup({ 'wss://a': new Set([e.id]), 'wss://b': new Set() })
    s.d.track(e, { 'wss://a': 'ok', 'wss://b': 'ok' }) // b said ok but does not have it
    expect(await s.d.tick()).toEqual({ confirmed: 0, resent: 0, gaveUp: 0 }) // not due yet
    s.advance(DELAYS[0]!); expect(await s.d.tick()).toEqual({ confirmed: 1, resent: 1, gaveUp: 0 })
    expect(s.sent).toEqual([{ relays: ['wss://b'], id: e.id }])
    s.advance(DELAYS[1]!); expect(await s.d.tick()).toEqual({ confirmed: 1, resent: 0, gaveUp: 0 })
    expect(s.pending()).toEqual([])
  })
  it('gives up on a relay that never keeps it, after the last pause, without signing anything again', async () => {
    const e = note(); const s = setup({})
    s.d.track(e, { 'wss://never': 'rate-limited' })
    let resent = 0, gaveUp = 0
    for (const ms of DELAYS) { s.advance(ms); const r = await s.d.tick(); resent += r.resent; gaveUp += r.gaveUp }
    expect(resent).toBe(DELAYS.length - 1); expect(gaveUp).toBe(1); expect(s.pending()).toEqual([])
    expect(new Set(s.sent.map((x) => x.id))).toEqual(new Set([e.id]))
  })
})
