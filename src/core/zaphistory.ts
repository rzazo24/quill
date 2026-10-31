// The reader's zap history, from the public receipts (kind 9735) on their relays: the zaps they received (the receipt names them with `p`) and the
// ones they sent (the zap request inside, signed by them). Nothing is asked of the wallet. Only what a receipt can prove is shown: a sender is named
// only if their request is validly signed and asks for the paid amount; a receipt whose request does not match is left out of "sent".
import type { Event } from 'nostr-tools'
import { invoiceSats, ZAP_RECEIPT_KIND } from './zap.js'

const HEX64 = /^[0-9a-f]{64}$/
export const HISTORY_SIZE = 20

export interface ZapEntry {
  id: string; at: number; sats: number; dir: 'in' | 'out'
  /** who sent it (received) or who got it (sent); null: an anonymous or unprovable sender */
  other: string | null
  /** the note it was for, if any */
  note: string | null
  comment: string
}

function request(receipt: Event, verify: (e: Event) => boolean, sats: number): Event | null {
  try {
    const req = JSON.parse(receipt.tags.find((t) => t[0] === 'description')?.[1] ?? 'null') as Event | null
    if (!req || req.kind !== 9734 || !HEX64.test(req.pubkey ?? '') || req.tags?.some((t) => t[0] === 'anon')) return null
    const asked = Number(req.tags.find((t) => t[0] === 'amount')?.[1])
    if (Number.isFinite(asked) && asked > 0 && Math.floor(asked / 1000) !== sats) return null
    return verify({ ...req }) ? req : null
  } catch { return null }
}

export function readEntry(receipt: Event, me: string, verify: (e: Event) => boolean): ZapEntry | null {
  if (receipt.kind !== ZAP_RECEIPT_KIND) return null
  const bolt11 = receipt.tags.find((t) => t[0] === 'bolt11')?.[1]
  const sats = bolt11 ? invoiceSats(bolt11) : null
  const to = receipt.tags.find((t) => t[0] === 'p' && HEX64.test(t[1] ?? ''))?.[1]
  if (!sats || !to) return null
  const req = request(receipt, verify, sats)
  const note = receipt.tags.find((t) => t[0] === 'e' && HEX64.test(t[1] ?? ''))?.[1] ?? null
  const base = { id: receipt.id, at: receipt.created_at, sats, note, comment: (req?.content ?? '').slice(0, 280) }
  if (req && req.pubkey === me && to !== me) return { ...base, dir: 'out', other: to }
  if (to === me) return { ...base, dir: 'in', other: req ? req.pubkey : null }
  return null
}

/** Received and sent, newest first, once each, the latest HISTORY_SIZE. */
export function zapHistory(receipts: Event[], me: string, verify: (e: Event) => boolean): ZapEntry[] {
  const seen = new Set<string>(), out: ZapEntry[] = []
  for (const r of [...receipts].sort((a, b) => b.created_at - a.created_at)) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    const e = readEntry(r, me, verify)
    if (e) out.push(e)
    if (out.length >= HISTORY_SIZE) break
  }
  return out
}
