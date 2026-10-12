// Asking the recipient's Lightning server for an invoice (LNURL-pay, LUD-06/16, with NIP-57 zaps). Two plain https requests, made from the browser:
// that server sees the reader's IP address and the zap request (which is public anyway, inside the receipt).
export interface PayInfo { callback: string; minSats: number; maxSats: number; nostrPubkey: string }
export type GetJson = (url: string) => Promise<unknown>

export const getJson: GetJson = async (url) => {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 10_000)
  try {
    const r = await fetch(url, { signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally { clearTimeout(timer) }
}

export class ZapError extends Error { constructor(readonly code: 'no-address' | 'no-zaps' | 'server' | 'amount' | 'invoice' | 'wallet' | 'signer', message: string = code) { super(message) } }

/** What the server takes: where to ask, the limits, and the key it signs receipts with. A server that does not do Nostr zaps is refused (no receipt would ever show). */
export async function payInfo(url: string, get: GetJson = getJson): Promise<PayInfo> {
  let d: Record<string, unknown>
  try { d = (await get(url)) as Record<string, unknown> } catch (e) { throw new ZapError('server', e instanceof Error ? e.message : String(e)) }
  if (!d || d.tag !== 'payRequest' || typeof d.callback !== 'string' || !/^https:\/\/[^\s]+$/.test(d.callback)) throw new ZapError('server', String(d?.reason ?? 'not a pay request'))
  if (d.allowsNostr !== true || typeof d.nostrPubkey !== 'string' || !/^[0-9a-f]{64}$/.test(d.nostrPubkey)) throw new ZapError('no-zaps')
  const minSats = Math.ceil(Number(d.minSendable ?? 1000) / 1000), maxSats = Math.floor(Number(d.maxSendable ?? 1e11) / 1000)
  return { callback: d.callback, minSats: Number.isFinite(minSats) ? minSats : 1, maxSats: Number.isFinite(maxSats) ? maxSats : 1e8, nostrPubkey: d.nostrPubkey }
}

/** The invoice for that amount, with the signed zap request inside (the server will publish the receipt with it). */
export async function zapInvoice(info: PayInfo, sats: number, zapRequest: object, lnurl: string, get: GetJson = getJson): Promise<string> {
  if (sats < info.minSats || sats > info.maxSats) throw new ZapError('amount', `${info.minSats}–${info.maxSats}`)
  const u = new URL(info.callback)
  u.searchParams.set('amount', String(sats * 1000)); u.searchParams.set('nostr', JSON.stringify(zapRequest)); u.searchParams.set('lnurl', lnurl)
  let d: Record<string, unknown>
  try { d = (await get(u.toString())) as Record<string, unknown> } catch (e) { throw new ZapError('server', e instanceof Error ? e.message : String(e)) }
  if (typeof d?.pr !== 'string' || !/^ln/i.test(d.pr)) throw new ZapError('server', String(d?.reason ?? 'no invoice'))
  return d.pr
}
