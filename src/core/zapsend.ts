// Sending a zap (NIP-57) paid by the reader's own wallet through Nostr Wallet Connect (NIP-47). Pure parts: reading the wallet's connection string,
// finding where the recipient's Lightning address lives, building the zap request (kind 9734) and checking it, and checking the invoice that comes back.
// The connection string is a permission to SPEND from the wallet: it is kept only on the device where it was pasted, never published, never sent
// anywhere but to the wallet's own relay (encrypted), and the reader is told so before pasting it.
import { bech32 } from '@scure/base'
import type { Template } from '../sign/policy.js'
import { normalizeRelay } from '../net/relays.js'
import { invoiceSats } from './zap.js'

export const ZAP_REQUEST_KIND = 9734
export const ZAP_AMOUNTS = [21, 100, 500, 1000, 5000] as const
export const MAX_ZAP_SATS = 100_000 // one zap; the wallet's own budget is the real limit
export const MAX_ZAP_COMMENT = 280
const HEX64 = /^[0-9a-f]{64}$/

export interface NwcConnection { walletPubkey: string; relays: string[]; secret: string; lud16?: string }

/** `nostr+walletconnect://<wallet pubkey>?relay=wss://…&secret=<hex>` (also the older `nostrwalletconnect:`). Null when anything is missing or wrong. */
export function parseNwc(text: string): NwcConnection | null {
  const s = text.trim()
  const m = /^(?:nostr\+walletconnect|nostrwalletconnect):\/{0,2}([0-9a-f]{64})\?(.+)$/i.exec(s)
  if (!m) return null
  const params = new URLSearchParams(m[2])
  const secret = (params.get('secret') ?? '').toLowerCase()
  const relays = [...new Set(params.getAll('relay').map((r) => normalizeRelay(decodeURIComponent(r))).filter((r): r is string => !!r))].slice(0, 4)
  if (!HEX64.test(secret) || !relays.length) return null
  const lud16 = params.get('lud16') ?? undefined
  return { walletPubkey: m[1]!.toLowerCase(), relays, secret, ...(lud16 ? { lud16 } : {}) }
}

/** Where to ask for an invoice: a Lightning address (name@domain, LUD-16) becomes https://domain/.well-known/lnurlp/name; an old lnurl1… (LUD-06) is decoded. Only https. */
export function payUrlOf(profile: { lud16?: unknown; lud06?: unknown }): string | null {
  const addr = typeof profile.lud16 === 'string' ? profile.lud16.trim().toLowerCase() : ''
  const am = /^([a-z0-9._+-]{1,64})@([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/.exec(addr)
  if (am) return `https://${am[2]}/.well-known/lnurlp/${am[1]}`
  const old = typeof profile.lud06 === 'string' ? profile.lud06.trim().toLowerCase() : ''
  if (old.startsWith('lnurl1')) {
    try {
      const { words } = bech32.decode(old as `${string}1${string}`, 2000)
      const url = new TextDecoder().decode(bech32.fromWords(words))
      return /^https:\/\/[^\s/]+\/\S*$/.test(url) ? url : null
    } catch { return null }
  }
  return null
}

/** The `lnurl` tag of a zap request: the pay URL, bech32-encoded. */
export const lnurlOf = (url: string): string => bech32.encode('lnurl', bech32.toWords(new TextEncoder().encode(url)), 2000)

/** The zap request: who and which note, how much (in millisats), where the receipt should go (the reader's relays), and an optional comment. */
export function zapRequestTemplate(o: { recipient: string; noteId: string; sats: number; relays: string[]; lnurl?: string; comment?: string; createdAt: number }): Template {
  return {
    kind: ZAP_REQUEST_KIND, created_at: o.createdAt, content: (o.comment ?? '').trim(),
    tags: [['relays', ...o.relays.slice(0, 10)], ['amount', String(o.sats * 1000)], ...(o.lnurl ? [['lnurl', o.lnurl]] : []), ['p', o.recipient], ['e', o.noteId]],
  }
}

/** Exactly the shape Quill builds: one note, one recipient, a whole number of sats up to the limit, tidy relays, an optional lnurl, a short comment. */
export function checkZapRequest(t: Template): boolean {
  if (t.kind !== ZAP_REQUEST_KIND || [...t.content].length > MAX_ZAP_COMMENT) return false
  const one = (name: string) => t.tags.filter((x) => x[0] === name)
  if (t.tags.some((x) => !['relays', 'amount', 'lnurl', 'p', 'e'].includes(x[0] ?? ''))) return false
  const [relays] = one('relays'), [amount] = one('amount'), [p] = one('p'), [e] = one('e'), lnurl = one('lnurl')
  if (one('relays').length !== 1 || one('amount').length !== 1 || one('p').length !== 1 || one('e').length !== 1 || lnurl.length > 1) return false
  const rs = relays!.slice(1)
  if (!rs.length || rs.length > 10 || !rs.every((u) => normalizeRelay(u) === u)) return false
  const msats = Number(amount![1])
  if (amount!.length !== 2 || !Number.isInteger(msats) || msats < 1000 || msats % 1000 !== 0 || msats > MAX_ZAP_SATS * 1000) return false
  if (p!.length !== 2 || !HEX64.test(p![1]!) || e!.length !== 2 || !HEX64.test(e![1]!)) return false
  if (lnurl.length && (lnurl[0]!.length !== 2 || !/^lnurl1[02-9ac-hj-np-z]{10,1990}$/.test(lnurl[0]![1]!))) return false
  return true
}

/** The invoice asks for exactly the amount chosen (a server that changed it is not paid). */
export const invoiceMatches = (bolt11: string, sats: number): boolean => invoiceSats(bolt11) === sats
