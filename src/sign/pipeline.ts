// From a template to a published event: is the signer awake -> ask for the signature -> publish to the relays. No DOM. The UI decides when to call it
// (after the user pressed Publish, or React); this decides nothing about what to sign: the policy is applied inside `Signer.sign`.
import type { Event } from 'nostr-tools'
import type { Publisher, Outcome } from '../net/publisher.js'
import { safeGet, safeSet, type KV } from '../ui/store.js'
import { canSign, recentSignatures, type Template } from './policy.js'
import type { Signer } from './signer.js'

export type SignerApi = Pick<Signer, 'state' | 'pubkey' | 'lastError' | 'authUrl' | 'onChange' | 'startConnect' | 'connectBunker' | 'resume' | 'sign' | 'disconnect' | 'hasSavedSession'>

export type Step = 'waiting' | 'sending'
export type FailCode = 'rate' | 'no-signer' | 'not-signed' | 'cancelled'

export class PipelineError extends Error {
  constructor(readonly code: FailCode, message: string) { super(message) }
}

export interface PipelineDeps { signer: SignerApi; publisher: Publisher; kv?: KV; now?: () => number; signTimeoutMs?: number; signal?: AbortSignal }
export interface Published { event: Event; outcomes: Record<string, Outcome> }

const stampsOf = (kv: KV | undefined): number[] => { try { const v = JSON.parse(safeGet(kv, 'signed') ?? '[]') as unknown; return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : [] } catch { return [] } }

export async function signAndPublish(d: PipelineDeps, t: Template, onStep: (s: Step) => void = () => {}): Promise<Published> {
  const nowSec = () => Math.floor((d.now ?? Date.now)() / 1000)
  if (d.signer.state !== 'connected') throw new PipelineError('no-signer', 'no signer is connected')
  if (!canSign(stampsOf(d.kv), nowSec())) throw new PipelineError('rate', 'too many signatures in the last hour')
  // One request, one notification: no "are you awake?" check first. A signer set to approve by itself may answer even from the background, which a
  // preliminary ping would never find out; a sleeping one just leaves the request waiting (with a Cancel button) until it is opened or the time runs out.
  onStep('waiting')
  let event: Event
  try { ({ event } = await d.signer.sign(t, d.signTimeoutMs ?? 300_000, d.signal)) } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new PipelineError(d.signal?.aborted || msg === 'cancelled' ? 'cancelled' : 'not-signed', msg)
  }
  safeSet(d.kv, 'signed', JSON.stringify([...recentSignatures(stampsOf(d.kv), nowSec()), nowSec()])) // counted when a signature was made, published or not
  onStep('sending')
  return { event, outcomes: await d.publisher.publish(event) }
}
