// Nostr Wallet Connect (NIP-47): the reader's wallet listens on its relay for requests signed with the connection's own key (the `secret` of the
// connection string, NOT the reader's Nostr key) and answers there. Requests and answers are encrypted to each other (NIP-44 when the wallet says it
// takes it, NIP-04 otherwise). Only the methods Quill needs: get_info, get_balance and pay_invoice.
import { finalizeEvent, getPublicKey, type Event } from 'nostr-tools'
import { Relay } from 'nostr-tools/relay'
import * as nip04 from 'nostr-tools/nip04'
import * as nip44 from 'nostr-tools/nip44'
import { hexToBytes } from 'nostr-tools/utils'
import type { NwcConnection } from '../core/zapsend.js'

export const NWC_INFO = 13194, NWC_REQUEST = 23194, NWC_RESPONSE = 23195
export type Encryption = 'nip44_v2' | 'nip04'
export type NwcMethod = 'get_info' | 'get_balance' | 'pay_invoice'

/** What the wallet's info event says it can encrypt with: NIP-44 if it names it, NIP-04 otherwise (the original, still the most common). */
export const encryptionOf = (info: Event | undefined): Encryption => ((info?.tags.find((t) => t[0] === 'encryption')?.[1] ?? '').split(/\s+/).includes('nip44_v2') ? 'nip44_v2' : 'nip04')

/** The request event, signed with the connection's key. Pure apart from the clock and the randomness of encryption. */
export function nwcRequest(c: NwcConnection, method: NwcMethod, params: Record<string, unknown>, enc: Encryption, now = Math.floor(Date.now() / 1000)): Event {
  const sk = hexToBytes(c.secret), body = JSON.stringify({ method, params })
  const content = enc === 'nip44_v2' ? nip44.encrypt(body, nip44.getConversationKey(sk, c.walletPubkey)) : nip04.encrypt(sk, c.walletPubkey, body)
  return finalizeEvent({ kind: NWC_REQUEST, created_at: now, content, tags: [['p', c.walletPubkey], ...(enc === 'nip44_v2' ? [['encryption', 'nip44_v2']] : [])] }, sk)
}

/** The answer to `requestId`, read: its result, or the wallet's error as an exception. Anything not from the wallet, or about another request, is null. */
export function readNwcResponse(c: NwcConnection, e: Event, requestId: string, enc: Encryption): Record<string, unknown> | null {
  if (e.kind !== NWC_RESPONSE || e.pubkey !== c.walletPubkey || !e.tags.some((t) => t[0] === 'e' && t[1] === requestId)) return null
  const sk = hexToBytes(c.secret)
  let body: { result_type?: string; result?: Record<string, unknown> | null; error?: { code?: string; message?: string } | null }
  try { body = JSON.parse(enc === 'nip44_v2' ? nip44.decrypt(e.content, nip44.getConversationKey(sk, c.walletPubkey)) : nip04.decrypt(sk, c.walletPubkey, e.content)) } catch { return null }
  if (body.error) throw new Error(`${body.error.code ?? 'ERROR'}: ${body.error.message ?? ''}`.trim())
  return body.result ?? {}
}

/** The connection's own public key (to tell the reader which "app" their wallet will list). */
export const nwcClientKey = (c: NwcConnection): string => getPublicKey(hexToBytes(c.secret))

/** One request and its answer, on the wallet's first relay that answers. `timeoutMs` bounds the whole thing. */
export async function nwcCall(c: NwcConnection, method: NwcMethod, params: Record<string, unknown> = {}, timeoutMs = 45_000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown = new Error('no relay answered')
  for (const url of c.relays) {
    let relay: Relay | null = null
    try {
      relay = await Relay.connect(url)
      const info = await new Promise<Event | undefined>((resolve) => {
        let found: Event | undefined
        const sub = relay!.subscribe([{ kinds: [NWC_INFO], authors: [c.walletPubkey], limit: 1 }], { onevent: (e) => { found = e }, oneose: () => { sub.close(); resolve(found) } })
        setTimeout(() => { sub.close(); resolve(found) }, 4000)
      })
      const enc = encryptionOf(info), req = nwcRequest(c, method, params, enc)
      const answer = new Promise<Record<string, unknown>>((resolve, reject) => {
        const sub = relay!.subscribe([{ kinds: [NWC_RESPONSE], authors: [c.walletPubkey], '#e': [req.id] }], {
          onevent: (e) => { try { const r = readNwcResponse(c, e, req.id, enc); if (r) { sub.close(); resolve(r) } } catch (err) { sub.close(); reject(err) } },
        })
        setTimeout(() => { sub.close(); reject(new Error('the wallet did not answer in time')) }, Math.max(1000, deadline - Date.now()))
      })
      await relay.publish(req)
      return await answer
    } catch (e) {
      lastError = e
      if (e instanceof Error && /^[A-Z_]+:/.test(e.message)) throw e // the wallet answered with an error: asking another relay would not change it
      if (Date.now() > deadline) break
    } finally { try { relay?.close() } catch { /* already closed */ } }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
