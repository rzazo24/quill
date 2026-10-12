import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { bytesToHex } from 'nostr-tools/utils'
import * as nip04 from 'nostr-tools/nip04'
import * as nip44 from 'nostr-tools/nip44'
import { checkZapRequest, invoiceMatches, lnurlOf, parseNwc, payUrlOf, zapRequestTemplate } from './zapsend.js'
import { checkTemplate } from '../sign/policy.js'
import { payInfo, zapInvoice, ZapError } from '../net/lnurl.js'
import { encryptionOf, nwcRequest, readNwcResponse, NWC_RESPONSE } from '../net/nwc.js'

const wallet = generateSecretKey(), walletPk = getPublicKey(wallet), secret = bytesToHex(generateSecretKey())
const uri = `nostr+walletconnect://${walletPk}?relay=wss%3A%2F%2Frelay.wallet.example&secret=${secret}&lud16=me%40wallet.example`
const A = 'a'.repeat(64), N = 'b'.repeat(64)

describe('the wallet connection string', () => {
  it('reads the wallet key, its relays and the secret; anything malformed is refused', () => {
    expect(parseNwc(uri)).toEqual({ walletPubkey: walletPk, relays: ['wss://relay.wallet.example'], secret, lud16: 'me@wallet.example' })
    expect(parseNwc(` ${uri.replace('nostr+walletconnect', 'nostrwalletconnect')} `)?.walletPubkey).toBe(walletPk)
    expect(parseNwc(uri.replace(/secret=[0-9a-f]+/, 'secret=xyz'))).toBeNull()
    expect(parseNwc(uri.replace(/relay=[^&]+/, 'relay=ws%3A%2F%2Fplain.example'))).toBeNull() // only secure relays
    expect(parseNwc(`bunker://${walletPk}?relay=wss://r.example&secret=${secret}`)).toBeNull()
    expect(parseNwc('nsec1whatever')).toBeNull()
  })
})

describe('where to ask for the invoice', () => {
  it('a Lightning address becomes its well-known https URL; an lnurl1 is decoded; anything else is nothing', () => {
    expect(payUrlOf({ lud16: 'Gigi@Primal.net' })).toBe('https://primal.net/.well-known/lnurlp/gigi')
    expect(payUrlOf({ lud06: lnurlOf('https://pay.example/lnurlp/x') })).toBe('https://pay.example/lnurlp/x')
    expect(payUrlOf({ lud06: lnurlOf('http://pay.example/x') })).toBeNull()
    expect(payUrlOf({ lud16: 'not an address' })).toBeNull(); expect(payUrlOf({})).toBeNull()
  })
})

describe('the zap request', () => {
  const t = zapRequestTemplate({ recipient: A, noteId: N, sats: 21, relays: ['wss://nos.lol', 'wss://relay.damus.io'], lnurl: lnurlOf('https://pay.example/x'), comment: ' thanks ', createdAt: 1 })
  it('says who, which note, how much (millisats) and where the receipt goes; the policy lets exactly that shape through', () => {
    expect(t.tags).toEqual([['relays', 'wss://nos.lol', 'wss://relay.damus.io'], ['amount', '21000'], ['lnurl', lnurlOf('https://pay.example/x')], ['p', A], ['e', N]])
    expect(t.content).toBe('thanks'); expect(checkZapRequest(t)).toBe(true); expect(checkTemplate(t)).toBeNull()
  })
  it('anything else is refused: an extra tag, two notes, fractions of a sat, too much, untidy relays, a long comment', () => {
    expect(checkTemplate({ ...t, tags: [...t.tags, ['t', 'x']] })).toBe('zap')
    expect(checkZapRequest({ ...t, tags: [...t.tags, ['e', A]] })).toBe(false)
    expect(checkZapRequest({ ...t, tags: t.tags.map((x) => (x[0] === 'amount' ? ['amount', '21500'] : x)) })).toBe(false)
    expect(checkZapRequest({ ...t, tags: t.tags.map((x) => (x[0] === 'amount' ? ['amount', String(200_000 * 1000)] : x)) })).toBe(false)
    expect(checkZapRequest({ ...t, tags: t.tags.map((x) => (x[0] === 'relays' ? ['relays', 'wss://Nos.lol/'] : x)) })).toBe(false)
    expect(checkZapRequest({ ...t, content: 'x'.repeat(281) })).toBe(false)
  })
  it('an invoice is paid only if it asks for exactly the amount chosen', () => {
    expect(invoiceMatches('lnbc210n1pexample', 21)).toBe(true); expect(invoiceMatches('lnbc10u1pexample', 21)).toBe(false)
  })
})

describe('the recipient\'s Lightning server', () => {
  const info = { tag: 'payRequest', callback: 'https://pay.example/cb?x=1', minSendable: 1000, maxSendable: 1e9, allowsNostr: true, nostrPubkey: A }
  it('asks for the invoice with the amount, the signed request and the lnurl', async () => {
    const asked: string[] = []
    const get = async (u: string) => { asked.push(u); return asked.length === 1 ? info : { pr: 'lnbc210n1pexample' } }
    const pi = await payInfo('https://pay.example/.well-known/lnurlp/x', get)
    expect(await zapInvoice(pi, 21, { kind: 9734 }, 'lnurl1xyz', get)).toBe('lnbc210n1pexample')
    const u = new URL(asked[1]!); expect(u.searchParams.get('amount')).toBe('21000'); expect(JSON.parse(u.searchParams.get('nostr')!)).toEqual({ kind: 9734 }); expect(u.searchParams.get('x')).toBe('1')
  })
  it('a server without Nostr zaps, an amount out of its limits, or an error are said as such', async () => {
    await expect(payInfo('u', async () => ({ ...info, allowsNostr: false }))).rejects.toMatchObject({ code: 'no-zaps' })
    await expect(zapInvoice({ callback: info.callback, minSats: 100, maxSats: 1000, nostrPubkey: A }, 21, {}, 'l', async () => ({}))).rejects.toBeInstanceOf(ZapError)
    await expect(zapInvoice({ callback: info.callback, minSats: 1, maxSats: 1000, nostrPubkey: A }, 21, {}, 'l', async () => ({ status: 'ERROR', reason: 'nope' }))).rejects.toMatchObject({ code: 'server', message: 'nope' })
  })
})

describe('talking to the wallet (NWC)', () => {
  const c = parseNwc(uri)!
  const answer = (reqId: string, body: object, enc: 'nip04' | 'nip44_v2', from = wallet) => {
    const clientPk = getPublicKey(Buffer.from(secret, 'hex'))
    const content = enc === 'nip44_v2' ? nip44.encrypt(JSON.stringify(body), nip44.getConversationKey(from, clientPk)) : nip04.encrypt(from, clientPk, JSON.stringify(body))
    return finalizeEvent({ kind: NWC_RESPONSE, created_at: 1, content, tags: [['p', clientPk], ['e', reqId]] }, from)
  }
  for (const enc of ['nip04', 'nip44_v2'] as const) {
    it(`a request the wallet can read, and its answer read back (${enc})`, () => {
      const req = nwcRequest(c, 'pay_invoice', { invoice: 'lnbc1' }, enc)
      const sk = wallet, plain = enc === 'nip44_v2' ? nip44.decrypt(req.content, nip44.getConversationKey(sk, req.pubkey)) : nip04.decrypt(sk, req.pubkey, req.content)
      expect(JSON.parse(plain)).toEqual({ method: 'pay_invoice', params: { invoice: 'lnbc1' } }); expect(req.tags[0]).toEqual(['p', walletPk])
      expect(readNwcResponse(c, answer(req.id, { result_type: 'pay_invoice', result: { preimage: 'ff' } }, enc), req.id, enc)).toEqual({ preimage: 'ff' })
      expect(() => readNwcResponse(c, answer(req.id, { result_type: 'pay_invoice', error: { code: 'INSUFFICIENT_BALANCE', message: 'no money' } }, enc), req.id, enc)).toThrow('INSUFFICIENT_BALANCE: no money')
      expect(readNwcResponse(c, answer(req.id, { result: {} }, enc, generateSecretKey()), req.id, enc)).toBeNull() // not from the wallet
      expect(readNwcResponse(c, answer('c'.repeat(64), { result: {} }, enc), req.id, enc)).toBeNull() // another request
    })
  }
  it('NIP-44 only when the wallet says it takes it', () => {
    expect(encryptionOf(undefined)).toBe('nip04')
    expect(encryptionOf(finalizeEvent({ kind: 13194, created_at: 1, content: 'pay_invoice', tags: [['encryption', 'nip44_v2 nip04']] }, wallet))).toBe('nip44_v2')
  })
})
