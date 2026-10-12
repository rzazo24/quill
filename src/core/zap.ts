// Zaps (NIP-57): sats sent over Lightning to a note, made public by a receipt (kind 9735) that the recipient's Lightning server publishes. The receipt
// carries the paid invoice (the amount) and, in `description`, the zap request (kind 9734) signed by whoever sent it (the sender). Quill reads the
// amount from the invoice, and names the sender only if that request is validly signed, points at the same note and asks for the same amount;
// otherwise the zap counts with no name. A receipt cannot be checked further without asking the recipient's Lightning server, which Quill does not do.
import type { Event } from 'nostr-tools'

export const ZAP_RECEIPT_KIND = 9735
const HEX64 = /^[0-9a-f]{64}$/
const UNIT: Record<string, number> = { '': 1e8, m: 1e5, u: 100, n: 0.1, p: 0.0001 } // sats per unit of the invoice's amount, by its multiplier letter

/** The amount of a BOLT11 invoice, in whole sats; null when it names none or cannot be read. */
export function invoiceSats(bolt11: string): number | null {
  const m = /^ln(?:bc|tb|bcrt|tbs)(\d+)([munp]?)1/i.exec(bolt11.trim())
  if (!m) return null
  const sats = Math.floor(Number(m[1]) * UNIT[m[2]!.toLowerCase()]!)
  return Number.isFinite(sats) && sats > 0 && sats < 21e14 ? sats : null
}

export interface Zap { target: string; sats: number; sender: string | null }

export function readZap(receipt: Event, verify: (e: Event) => boolean): Zap | null {
  if (receipt.kind !== ZAP_RECEIPT_KIND) return null
  const target = receipt.tags.find((t) => t[0] === 'e' && HEX64.test(t[1] ?? ''))?.[1]
  const bolt11 = receipt.tags.find((t) => t[0] === 'bolt11')?.[1]
  const sats = bolt11 ? invoiceSats(bolt11) : null
  if (!target || !sats) return null
  let sender: string | null = null
  try {
    const req = JSON.parse(receipt.tags.find((t) => t[0] === 'description')?.[1] ?? 'null') as Event | null
    const asked = Number(req?.tags?.find((t) => t[0] === 'amount')?.[1])
    const sameNote = !!req?.tags?.some((t) => t[0] === 'e' && t[1] === target)
    const sameAmount = !Number.isFinite(asked) || asked <= 0 || Math.floor(asked / 1000) === sats
    if (req && req.kind === 9734 && sameNote && sameAmount && !req.tags.some((t) => t[0] === 'anon') && HEX64.test(req.pubkey) && verify(req)) sender = req.pubkey
  } catch { /* no readable request: the zap counts with no name */ }
  return { target, sats, sender }
}

/** "1,234" / "1.234" by language; 1000 or more as "1.2k". */
export const formatSats = (n: number, lang: 'en' | 'es'): string => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString(lang === 'es' ? 'es-ES' : 'en-GB')
