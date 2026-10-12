// From a template to a published event: is the signer awake -> ask for the signature -> publish to the relays. No DOM. The UI decides when to call it
// (after the user pressed Publish, or React); this decides nothing about what to sign: the policy is applied inside `Signer.sign`.
import type { Event } from 'nostr-tools'
import type { Publisher, Outcome } from '../net/publisher.js'
import { safeGet, safeSet, type KV } from '../ui/store.js'
import { allowanceOf, canSign, recentSignatures, type Template } from './policy.js'
import type { Signer } from './signer.js'

export type SignerApi = Pick<Signer, 'state' | 'pubkey' | 'lastError' | 'authUrl' | 'onChange' | 'startConnect' | 'connectBunker' | 'resume' | 'sign' | 'disconnect' | 'hasSavedSession'>

/** How long to wait for the signer to sign. A request made while the signer app is closed is never picked up later, so a long wait only hides the problem. */
export const SIGN_WAIT_MS = 90_000

export type Step = 'waiting' | 'sending'
export type FailCode = 'rate' | 'no-signer' | 'not-signed' | 'cancelled'

export class PipelineError extends Error {
  constructor(readonly code: FailCode, message: string) { super(message) }
}

/** `followBase`: the reader's follow list a follow-list change was built from (the policy checks the change against it). */
export interface PipelineDeps { signer: SignerApi; publisher: Publisher; kv?: KV; now?: () => number; signTimeoutMs?: number; signal?: AbortSignal; followBase?: Event | null; profileBase?: Event; deleteTarget?: Event }
export interface Published { event: Event; outcomes: Record<string, Outcome> }

const stampsOf = (kv: KV | undefined, key = 'signed'): number[] => { try { const v = JSON.parse(safeGet(kv, key) ?? '[]') as unknown; return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : [] } catch { return [] } }

export async function signAndPublish(d: PipelineDeps, t: Template, onStep: (s: Step) => void = () => {}): Promise<Published> {
  const nowSec = () => Math.floor((d.now ?? Date.now)() / 1000)
  if (d.signer.state !== 'connected') throw new PipelineError('no-signer', 'no signer is connected')
  const allow = allowanceOf(t.kind)
  if (!canSign(stampsOf(d.kv, allow.key), nowSec(), allow.max)) throw new PipelineError('rate', 'too many signatures in the last hour')
  // One request, one notification: no "are you awake?" check first. A signer set to approve by itself may answer even from the background, which a
  // preliminary ping would never find out; a sleeping one just leaves the request waiting (with a Cancel button) until it is opened or the time runs out.
  onStep('waiting')
  let event: Event
  try { ({ event } = await d.signer.sign(t, d.signTimeoutMs ?? SIGN_WAIT_MS, d.signal, { followBase: d.followBase, ...(d.profileBase ? { profileBase: d.profileBase } : {}), ...(d.deleteTarget ? { deleteTarget: d.deleteTarget } : {}) })) } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new PipelineError(d.signal?.aborted || msg === 'cancelled' ? 'cancelled' : 'not-signed', msg)
  }
  safeSet(d.kv, allow.key, JSON.stringify([...recentSignatures(stampsOf(d.kv, allow.key), nowSec()), nowSec()])) // counted when a signature was made, published or not
  onStep('sending')
  return { event, outcomes: await d.publisher.publish(event) }
}

/** Signs without publishing (a zap request goes to the recipient's Lightning server, not to relays). Same checks and count as `signAndPublish`. */
export async function signOnly(d: Pick<PipelineDeps, 'signer' | 'kv' | 'now' | 'signTimeoutMs' | 'signal'>, t: Template): Promise<Event> {
  const nowSec = () => Math.floor((d.now ?? Date.now)() / 1000)
  if (d.signer.state !== 'connected') throw new PipelineError('no-signer', 'no signer is connected')
  const allow = allowanceOf(t.kind)
  if (!canSign(stampsOf(d.kv, allow.key), nowSec(), allow.max)) throw new PipelineError('rate', 'too many signatures in the last hour')
  let event: Event
  try { ({ event } = await d.signer.sign(t, d.signTimeoutMs ?? SIGN_WAIT_MS, d.signal)) } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new PipelineError(d.signal?.aborted || msg === 'cancelled' ? 'cancelled' : 'not-signed', msg)
  }
  safeSet(d.kv, allow.key, JSON.stringify([...recentSignatures(stampsOf(d.kv, allow.key), nowSec()), nowSec()]))
  return event
}
