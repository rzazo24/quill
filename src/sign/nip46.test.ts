// The NIP-46 client against an in-memory relay that STORES kind 24133 (like relay.powr.build) and a pretend signer. The point of this client is the
// answer that arrives while the page is asleep: those tests publish the answer first (or cut the connection) and check that it is still found.
import { finalizeEvent, generateSecretKey, getPublicKey, nip44, type Event } from 'nostr-tools'
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool'
import WebSocket from 'ws'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeSigner } from '../../test/support/fake-signer.js'
import { startMiniRelay, type MiniRelay } from '../../test/support/mini-relay.js'
import { Nip46Client, NIP46_KIND } from './nip46.js'

useWebSocketImplementation(WebSocket)
const sec = () => Math.floor(Date.now() / 1000)
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('Nip46Client', () => {
  let relay: MiniRelay
  const stops: (() => void | Promise<void>)[] = []
  beforeAll(async () => { relay = await startMiniRelay() })
  afterAll(async () => { for (const s of stops) await s(); await relay.stop() })

  const make = (over: Partial<ConstructorParameters<typeof Nip46Client>[0]> = {}, secret = generateSecretKey()) => {
    const pool = new SimplePool(); const client = new Nip46Client({ pool, relays: [relay.url], secret, pollMs: 120, ...over })
    stops.push(() => { client.close(); pool.close([relay.url]) })
    return { client, pool, secret }
  }
  const uriFor = (client: Nip46Client, secret: string) => `nostrconnect://${client.pubkey}?relay=${encodeURIComponent(relay.url)}&secret=${secret}`
  const fakeSigner = async (behaviour = {}) => { const f = new FakeSigner({ delayMs: 20, ...behaviour }); stops.push(() => f.stop()); return f }
  /** What the signer would see: the requests addressed to it, decrypted. */
  const requestsTo = (signerSk: Uint8Array) => relay.stored.filter((e) => e.kind === NIP46_KIND && e.tags.some((t) => t[0] === 'p' && t[1] === getPublicKey(signerSk))).map((e) => ({ e, req: JSON.parse(nip44.decrypt(e.content, nip44.getConversationKey(signerSk, e.pubkey))) as { id: string; method: string; params: string[] } }))
  const reply = (signerSk: Uint8Array, clientPk: string, body: Record<string, unknown>, tamper?: (e: Event) => Event): Event => {
    const e = finalizeEvent({ kind: NIP46_KIND, created_at: sec(), tags: [['p', clientPk]], content: nip44.encrypt(JSON.stringify(body), nip44.getConversationKey(signerSk, clientPk)) }, signerSk)
    return tamper ? tamper(e) : e
  }
  const putOnRelay = async (e: Event) => { const ws = new WebSocket(relay.url); await new Promise<void>((r) => ws.on('open', () => r())); ws.send(JSON.stringify(['EVENT', e])); await tick(60); ws.close() }

  it('pairs through a nostrconnect link and then asks the signer things', async () => {
    const { client } = make(); const secret = 'aa'.repeat(16); const f = await fakeSigner()
    const waiting = client.waitForPairing(secret, sec(), { timeoutMs: 5000 })
    await f.scan(uriFor(client, secret))
    const signerPk = await waiting
    expect(signerPk).toBe(f.signerPk)
    client.setSigner(signerPk)
    expect(await client.request('get_public_key', [], { timeoutMs: 5000 })).toBe(f.userPk)
    expect(await client.request('ping', [], { timeoutMs: 5000 })).toBe('pong')
  }, 20_000)

  it('finds a pairing answer that was published BEFORE the client started waiting (a reloaded page), by polling alone', async () => {
    const secret = 'bb'.repeat(16); const { client, secret: sk } = make({ live: false })
    const f = await fakeSigner(); await f.scan(uriFor(client, secret)) // the signer answers; nobody is listening yet
    await tick(150); expect(relay.stored.some((e) => e.pubkey === f.signerPk)).toBe(true)
    const again = make({ live: false }, sk).client // "the page is reloaded": a brand new client with the same app key
    expect(await again.waitForPairing(secret, sec() - 2, { timeoutMs: 5000 })).toBe(f.signerPk)
  }, 20_000)

  it('finds the answer to a request even if the connection was cut meanwhile (the page slept)', async () => {
    const { client } = make({ live: false }); const secret = 'cc'.repeat(16); const f = await fakeSigner({ delayMs: 600 })
    const w = client.waitForPairing(secret, sec(), { timeoutMs: 5000 }); await f.scan(uriFor(client, secret).replace(encodeURIComponent(relay.url), encodeURIComponent(relay.url + '/signer'))); client.setSigner(await w) // the signer lives on its own path so that cutting the page's sockets does not cut it
    const answer = client.request('sign_event', [JSON.stringify({ kind: 1, content: 'slept through it', tags: [], created_at: sec() })], { timeoutMs: 8000 })
    await tick(80); relay.dropConnections('/signer') // Safari suspends the page: every socket dies; the signer answers 600 ms after the request
    const signed = JSON.parse(await answer) as Event
    expect(signed.content).toBe('slept through it'); expect(signed.pubkey).toBe(f.userPk)
  }, 25_000)

  it('ignores answers that are not for it: wrong secret, wrong id, another key, a forged signature', async () => {
    const { client } = make(); const secret = 'dd'.repeat(16); const signerSk = generateSecretKey()
    const pairing = client.waitForPairing(secret, sec(), { timeoutMs: 4000 })
    const intruder = generateSecretKey()
    await putOnRelay(reply(intruder, client.pubkey, { id: 'x', result: 'not the secret' }))
    await putOnRelay(reply(intruder, client.pubkey, { id: 'x', result: 'ack' }))
    await putOnRelay(reply(signerSk, client.pubkey, { id: 'x', result: secret }, (e) => ({ ...e, sig: '0'.repeat(128) }))) // right secret, forged signature
    await tick(500)
    let settled = false; void pairing.then(() => { settled = true }, () => { settled = true }); await tick(200)
    expect(settled).toBe(false) // still waiting
    await putOnRelay(reply(signerSk, client.pubkey, { id: 'x', result: secret }))
    expect(await pairing).toBe(getPublicKey(signerSk))
    client.setSigner(getPublicKey(signerSk))
    const asked = client.request('get_public_key', [], { timeoutMs: 4000 })
    await tick(150)
    const [{ req }] = requestsTo(signerSk).slice(-1)
    await putOnRelay(reply(intruder, client.pubkey, { id: req.id, result: 'f'.repeat(64) })) // right id, but not the signer
    await putOnRelay(reply(signerSk, client.pubkey, { id: 'someone else', result: 'a'.repeat(64) })) // the signer, but another request
    await tick(300)
    await putOnRelay(reply(signerSk, client.pubkey, { id: req.id, result: '1'.repeat(64) }))
    expect(await asked).toBe('1'.repeat(64))
  }, 25_000)

  it('rejects with the signer\'s own error; keeps waiting through an auth_url; times out; can be cancelled', async () => {
    const { client } = make(); const signerSk = generateSecretKey(); client.setSigner(getPublicKey(signerSk))
    const urls: string[] = []; const withUrl = make({ onAuthUrl: (u) => urls.push(u) }); withUrl.client.setSigner(getPublicKey(signerSk))
    const refused = client.request('sign_event', ['{}'], { timeoutMs: 4000 }); refused.catch(() => {}); await tick(200)
    const r1 = requestsTo(signerSk).filter((x) => x.e.pubkey === client.pubkey).at(-1)!.req
    await putOnRelay(reply(signerSk, client.pubkey, { id: r1.id, error: 'user rejected the request' }))
    await expect(refused).rejects.toThrow('user rejected the request')

    const auth = withUrl.client.request('get_public_key', [], { timeoutMs: 4000 }); auth.catch(() => {}); await tick(200)
    const r2 = requestsTo(signerSk).filter((x) => x.e.pubkey === withUrl.client.pubkey).at(-1)!.req
    await putOnRelay(reply(signerSk, withUrl.client.pubkey, { id: r2.id, result: 'auth_url', error: 'https://approve.example/x' }))
    await tick(300); expect(urls).toEqual(['https://approve.example/x'])
    await putOnRelay(reply(signerSk, withUrl.client.pubkey, { id: r2.id, result: '2'.repeat(64) }))
    expect(await auth).toBe('2'.repeat(64))

    await expect(client.request('ping', [], { timeoutMs: 300 })).rejects.toThrow(/did not answer within/)
    const ac = new AbortController(); const cancelled = client.request('ping', [], { timeoutMs: 8000, signal: ac.signal }); cancelled.catch(() => {}); setTimeout(() => ac.abort(), 100)
    await expect(cancelled).rejects.toThrow('cancelled')
    await expect(client.request('ping', [], { timeoutMs: 8000, signal: AbortSignal.abort() })).rejects.toThrow('cancelled')
  }, 25_000)

  it('stops asking the relay once nothing is pending (no background polling forever)', async () => {
    const { client } = make(); const signerSk = generateSecretKey(); client.setSigner(getPublicKey(signerSk))
    await expect(client.request('ping', [], { timeoutMs: 250 })).rejects.toThrow(/did not answer/)
    await tick(200); const before = relay.reqs; await tick(600)
    expect(relay.reqs).toBe(before)
  }, 15_000)

  it('refuses to send a request with no signer, and pending waits are rejected when the client is closed', async () => {
    const { client } = make(); await expect(client.request('ping', [], { timeoutMs: 100 })).rejects.toThrow('no signer')
    const signerSk = generateSecretKey(); client.setSigner(getPublicKey(signerSk))
    const pending = client.request('ping', [], { timeoutMs: 8000 }); pending.catch(() => {}); await tick(100); client.close()
    await expect(pending).rejects.toThrow('closed')
  }, 15_000)
})
