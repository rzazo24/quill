import type { Event } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import { ev, pk } from '../core/testutil.js'
import type { Publisher } from '../net/publisher.js'
import { PipelineError, signAndPublish, type SignerApi, type Step } from './pipeline.js'
import { MAX_SIGNATURES_PER_HOUR } from './policy.js'

const NOW = 1_700_000_000_000
const note = { kind: 1, content: 'hi', tags: [] as string[][], created_at: NOW / 1000 }
const mem = () => { const m = new Map<string, string>(); return { m, kv: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } } }

function fakeSigner(over: Partial<{ state: string; signError: string; hang: boolean }> = {}) {
  const calls: string[] = []
  const signer = {
    state: over.state ?? 'connected', pubkey: pk('a'),
    sign: async (t: typeof note, _ms: number, signal?: AbortSignal) => {
      calls.push('sign'); if (over.signError) throw new Error(over.signError)
      if (over.hang) await new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new Error('cancelled'))))
      return { event: ev(pk('a'), t.content, { kind: t.kind, tags: t.tags }) as Event & { [k: symbol]: true }, ms: 5 } },
  } as unknown as SignerApi
  return { signer, calls }
}
const publisher = (outcomes: Record<string, string> = { 'wss://r1': 'ok' }): Publisher & { sent: Event[] } => { const sent: Event[] = []; return { sent, publish: async (e) => { sent.push(e); return outcomes } } }
const run = (d: Parameters<typeof signAndPublish>[0], steps: Step[] = []) => signAndPublish({ now: () => NOW, ...d }, note, (s) => steps.push(s))

describe('signAndPublish', () => {
  it('asks for the signature (one request, no "are you awake?" first), then publishes', async () => {
    const { signer, calls } = fakeSigner(); const p = publisher(); const steps: Step[] = []
    const r = await run({ signer, publisher: p }, steps)
    expect(calls).toEqual(['sign']); expect(steps).toEqual(['waiting', 'sending'])
    expect(p.sent).toHaveLength(1); expect(r.outcomes).toEqual({ 'wss://r1': 'ok' })
  })
  it('without a connected signer nothing happens at all', async () => {
    const { signer, calls } = fakeSigner({ state: 'disconnected' }); const p = publisher()
    await expect(run({ signer, publisher: p })).rejects.toMatchObject({ code: 'no-signer' })
    expect(calls).toEqual([]); expect(p.sent).toEqual([])
  })
  it('a signer that never answers ends in a timeout error: nothing published, nothing counted', async () => {
    const { signer } = fakeSigner({ signError: 'the signer did not answer within 300 s' }); const p = publisher(); const store = mem()
    await expect(run({ signer, publisher: p, kv: store.kv })).rejects.toMatchObject({ code: 'not-signed', message: expect.stringMatching(/did not answer within/) })
    expect(p.sent).toEqual([]); expect(store.m.has('signed')).toBe(false)
  })
  it('the user can stop waiting: cancelled, nothing published, nothing counted', async () => {
    const { signer } = fakeSigner({ hang: true }); const p = publisher(); const store = mem(); const ac = new AbortController()
    const pending = run({ signer, publisher: p, kv: store.kv, signal: ac.signal })
    setTimeout(() => ac.abort(), 20)
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    expect(p.sent).toEqual([]); expect(store.m.has('signed')).toBe(false)
  })
  it('a refused or failed signature publishes nothing and is not counted', async () => {
    const { signer } = fakeSigner({ signError: 'user rejected the request' }); const p = publisher(); const store = mem()
    await expect(run({ signer, publisher: p, kv: store.kv })).rejects.toThrow(/rejected/)
    expect(p.sent).toEqual([]); expect(store.m.has('signed')).toBe(false)
    await expect(run({ signer, publisher: p })).rejects.toBeInstanceOf(PipelineError)
  })
  it('counts signatures per hour and stops at the cap, before bothering the signer', async () => {
    const store = mem(); store.m.set('signed', JSON.stringify(Array.from({ length: MAX_SIGNATURES_PER_HOUR }, () => NOW / 1000 - 60)))
    const { signer, calls } = fakeSigner()
    await expect(run({ signer, publisher: publisher(), kv: store.kv })).rejects.toMatchObject({ code: 'rate' })
    expect(calls).toEqual([])
    store.m.set('signed', JSON.stringify(Array.from({ length: MAX_SIGNATURES_PER_HOUR }, () => NOW / 1000 - 4000))) // an hour ago: free again
    await run({ signer, publisher: publisher(), kv: store.kv })
    expect(JSON.parse(store.m.get('signed')!)).toHaveLength(1)
  })
  it('junk in storage does not break it', async () => {
    const store = mem(); store.m.set('signed', '{"not":"a list"}')
    await run({ signer: fakeSigner().signer, publisher: publisher(), kv: store.kv })
    expect(JSON.parse(store.m.get('signed')!)).toEqual([NOW / 1000])
  })
  it('a signed event still reaches the caller when every relay failed, so it can be retried without a new signature', async () => {
    const r = await run({ signer: fakeSigner().signer, publisher: publisher({ 'wss://r1': 'no answer from the relay' }) })
    expect(r.event.content).toBe('hi'); expect(Object.values(r.outcomes)).toEqual(['no answer from the relay'])
  })
})
