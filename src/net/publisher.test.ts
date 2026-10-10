import type { Event } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import { failedRelays, poolPublisher } from './publisher.js'

const event = { id: 'a'.repeat(64) } as Event
const A = 'wss://a.example', B = 'wss://b.example'
/** A pretend pool: what each relay answers on its 1st, 2nd... try ('ok', an error message, or 'hang' for never). */
const fakePool = (script: Record<string, string[]>) => {
  const calls: string[] = [], closed: string[] = []
  const pool = { publish: (urls: string[]) => { const u = urls[0]!; calls.push(u); const step = (script[u] ?? ['ok'])[calls.filter((c) => c === u).length - 1] ?? 'ok'; return [step === 'hang' ? new Promise<string>(() => {}) : step === 'ok' ? Promise.resolve('') : Promise.reject(new Error(step))] }, close: (urls: string[]) => { closed.push(...urls) } }
  return { pool: pool as never, calls, closed }
}

describe('publishing to the relays', () => {
  it('everything accepted: one try each, nothing closed', async () => {
    const f = fakePool({}); expect(await poolPublisher([A, B], 100, f.pool).publish(event)).toEqual({ [A]: 'ok', [B]: 'ok' }); expect(f.calls.sort()).toEqual([A, B]); expect(f.closed).toEqual([])
  })
  it('a dead connection (the app was in the background) is tried again on a NEW connection and then works', async () => {
    const f = fakePool({ [A]: ['connection failure: socket closed', 'ok'] }); const r = await poolPublisher([A, B], 100, f.pool).publish(event)
    expect(r).toEqual({ [A]: 'ok', [B]: 'ok' }); expect(f.calls.filter((c) => c === A)).toHaveLength(2); expect(f.calls.filter((c) => c === B)).toHaveLength(1); expect(f.closed).toEqual([A]) // only the relay that failed is touched
  })
  it('no answer at all is also tried again once', async () => {
    const f = fakePool({ [A]: ['hang', 'ok'] }); expect(await poolPublisher([A], 50, f.pool).publish(event)).toEqual({ [A]: 'ok' }); expect(f.calls).toHaveLength(2)
  })
  it('a relay that SAYS no with a reason is not asked again: it is reported as it said', async () => {
    const f = fakePool({ [A]: ['blocked: not on the allow list'], [B]: ['rate-limited: slow down'] })
    const r = await poolPublisher([A, B], 100, f.pool).publish(event); expect(r[A]).toBe('blocked: not on the allow list'); expect(r[B]).toBe('rate-limited: slow down'); expect(f.calls).toHaveLength(2); expect(f.closed).toEqual([]); expect(failedRelays(r).sort()).toEqual([A, B])
  })
  it('a connection that stays down is reported after the second try, and does not hold the others up', async () => {
    const f = fakePool({ [A]: ['connection failure', 'connection failure again'] }); const r = await poolPublisher([A, B], 100, f.pool).publish(event)
    expect(r[A]).toBe('connection failure again'); expect(r[B]).toBe('ok'); expect(f.calls.filter((c) => c === A)).toHaveLength(2); expect(failedRelays(r)).toEqual([A])
  })
  it('publishing only to some relays (the retry button) touches only those', async () => {
    const f = fakePool({}); expect(await poolPublisher([A, B], 100, f.pool).publish(event, [B])).toEqual({ [B]: 'ok' }); expect(f.calls).toEqual([B])
  })
})
