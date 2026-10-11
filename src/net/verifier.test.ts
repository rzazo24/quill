import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, verifyEvent, type Event } from 'nostr-tools/pure'
import { acceptMany } from './fetcher.js'
import { verifyHere, workerVerifier } from './verifier.js'

const sk = generateSecretKey()
let n = 0
const good = () => finalizeEvent({ kind: 1, content: `hello ${n++}`, tags: [], created_at: 1_700_000_000 }, sk)
/** A pretend worker that runs the real check, as the browser's would, and answers asynchronously. */
class FakeWorker { onmessage: ((m: MessageEvent) => void) | null = null; postMessage(d: { id: number; events: Event[] }) { setTimeout(() => this.onmessage?.({ data: { id: d.id, ok: d.events.map((e) => verifyEvent(e)) } } as MessageEvent), 1) } }

describe('signatures checked all together (workers)', () => {
  for (const [name, verify] of [['here', verifyHere], ['in workers', workerVerifier(() => new FakeWorker() as unknown as Worker, 3)]] as const) {
    it(`${name}: a forged or altered event is dropped, good ones are kept, in order, once each`, async () => {
      const a = good(), b = good(), forged = { ...JSON.parse(JSON.stringify(good())), content: 'changed after signing' }, wrongSig = { ...JSON.parse(JSON.stringify(good())), sig: '00'.repeat(64) } // through JSON, as from a relay (a spread would copy the "already checked" mark)
      const many = Array.from({ length: 120 }, good) // more than one batch
      const out = await acceptMany({ kinds: [1] }, [a, forged, b, a, wrongSig, ...many], verify)
      expect(out.map((e) => e.id)).toEqual([a.id, b.id, ...many.map((e) => e.id)])
    })
  }
  it('drops what does not answer the question asked, before checking anything', async () => {
    let asked = 0; const counting = async (es: Event[]) => { asked += es.length; return es.map(() => true) }
    const out = await acceptMany({ kinds: [7] }, [good(), good()], counting)
    expect(out).toEqual([]); expect(asked).toBe(0)
  })
})
