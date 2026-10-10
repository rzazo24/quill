// The signer against a REAL relay (the khatru build, RELAY_BIN) and a pretend Clave that speaks the real NIP-46 protocol. Skipped without the binary.
import { useWebSocketImplementation } from 'nostr-tools/pool'
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools'
import WebSocket from 'ws'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeSigner } from '../../test/support/fake-signer.js'
import { relayBinary, startRelay, type TestRelay } from '../../test/support/relay-harness.js'
import { poolPublisher, failedRelays } from '../net/publisher.js'
import { accept } from '../net/fetcher.js'
import { Signer } from './signer.js'
import { followTemplate } from '../core/follow.js'

useWebSocketImplementation(WebSocket)
const bin = relayBinary()
const NOW = () => Math.floor(Date.now() / 1000)
const mem = () => { const m = new Map<string, string>(); return { m, kv: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } } }
const note = (content = 'hello from the test') => ({ kind: 1, content, tags: [] as string[][], created_at: NOW() })

describe.skipIf(!bin)('Signer with a pretend Clave through a real relay', () => {
  let relay: TestRelay
  const fakes: FakeSigner[] = []
  const signers: Signer[] = []
  beforeAll(async () => { relay = await startRelay(bin!) }, 60_000)
  afterAll(async () => { for (const f of fakes) await f.stop(); for (const s of signers) await s.disconnect(); await relay.stop() })

  async function connected(behaviour: ConstructorParameters<typeof FakeSigner>[0] = {}, timeouts = {}) {
    const store = mem()
    const signer = new Signer({ kv: store.kv, relays: [relay.url], timeouts: { connectMs: 8000, identityMs: 5000, resumeMs: 3000, attemptMs: 1000, ...timeouts } })
    signers.push(signer)
    const fake = new FakeSigner({ delayMs: 50, ...behaviour }); fakes.push(fake)
    const { uri, claveLink, done } = signer.startConnect()
    expect(claveLink.startsWith('https://clave.casa/connect/?uri=')).toBe(true)
    await fake.scan(uri)
    expect(await done).toBe(true)
    return { signer, fake, store }
  }

  it('connects through a nostrconnect link, asks only for notes and reactions, and learns the user\'s key', async () => {
    const { signer, fake, store } = await connected()
    expect(signer.state).toBe('connected'); expect(signer.pubkey).toBe(fake.userPk)
    const saved = JSON.parse(store.m.get('signer')!)
    expect(saved.signerPubkey).toBe(fake.signerPk); expect(Object.keys(saved).sort()).toEqual(['clientSecret', 'relays', 'signerPubkey', 'userPubkey'])
    expect(JSON.stringify([...store.m.values()])).not.toContain(Buffer.from(fake.userSk).toString('hex')) // the user's private key never reaches the app
  }, 30_000)

  it('requests ask for sign_event for notes (1), the follow list (3), reposts (6), reactions (7) and the relay list (10002) only', async () => {
    const store = mem(); const signer = new Signer({ kv: store.kv, relays: [relay.url] }); signers.push(signer)
    const u = new URL(signer.startConnect().uri)
    expect(u.searchParams.get('perms')).toBe('get_public_key,sign_event:1,sign_event:3,sign_event:6,sign_event:7,sign_event:10002'); expect(u.searchParams.get('name')).toBe('Quill'); expect(u.searchParams.has('url')).toBe(false)
    const withUrl = new URL(new Signer({ kv: mem().kv, relays: [relay.url], appUrl: 'https://quill.example' }).startConnect().uri)
    expect(withUrl.searchParams.get('url')).toBe('https://quill.example')
    expect(new URL(new Signer({ kv: mem().kv, relays: [relay.url], appUrl: 'http://insecure.example' }).startConnect().uri).searchParams.has('url')).toBe(false)
  })

  it('signs, verifies, and the event can be published to the relay and read back', async () => {
    const { signer, fake } = await connected()
    const { event, ms } = await signer.sign(note(), 5000)
    expect(event.pubkey).toBe(fake.userPk); expect(ms).toBeGreaterThanOrEqual(0)
    const r = await poolPublisher([relay.url, 'wss://127.0.0.1:1'], 2500).publish(event)
    expect(r[relay.url]).toBe('ok'); expect(r['wss://127.0.0.1:1']).not.toBe('ok'); expect(failedRelays(r)).toEqual(['wss://127.0.0.1:1'])
    const ws = new WebSocket(relay.url); const got: Event[] = []
    await new Promise<void>((res) => { ws.on('open', () => ws.send(JSON.stringify(['REQ', 'x', { ids: [event.id] }]))); ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m[0] === 'EVENT') got.push(m[2]); if (m[0] === 'EOSE') res() }) })
    ws.close(); expect(accept({ ids: [event.id] }, got)).toHaveLength(1)
  }, 30_000)

  it('refuses what Quill must not sign, before asking the signer at all', async () => {
    const { signer, fake } = await connected()
    for (const bad of [{ ...note(), kind: 5 }, { ...note(), kind: 3 }, note('  '), { ...note(), tags: [['p', 'x'], ['weird', 'y']] }]) await expect(signer.sign(bad, 2000)).rejects.toThrow(/will not sign/)
    expect(fake.signRequests).toBe(0)
  }, 30_000)

  it('a follow-list change is signed only when it comes with the reader\'s OWN validly signed list it was built from, and with exactly one account more or less', async () => {
    const { signer, fake } = await connected(); const base = finalizeEvent({ kind: 3, created_at: NOW() - 100, tags: [['p', 'a'.repeat(64)], ['p', 'b'.repeat(64)]], content: '' }, fake.userSk)
    const add = followTemplate(base, 'c'.repeat(64), 'follow', NOW())!
    await expect(signer.sign(add, 5000)).rejects.toThrow(/follow/) // no base: refused before the signer is asked
    expect(fake.signRequests).toBe(0)
    const stranger = finalizeEvent({ kind: 3, created_at: NOW() - 100, tags: [['p', 'a'.repeat(64)], ['p', 'b'.repeat(64)]], content: '' }, generateSecretKey()) // somebody else's list
    await expect(signer.sign(add, 5000, undefined, { followBase: stranger })).rejects.toThrow(/follow/)
    await expect(signer.sign(add, 5000, undefined, { followBase: JSON.parse(JSON.stringify({ ...base, sig: '0'.repeat(128) })) as Event })).rejects.toThrow(/follow/) // not validly signed
    await expect(signer.sign({ ...add, tags: [] }, 5000, undefined, { followBase: base })).rejects.toThrow(/follow/) // a wiped list
    await expect(signer.sign({ ...add, tags: [['p', 'a'.repeat(64)], ['p', 'c'.repeat(64)]] }, 5000, undefined, { followBase: base })).rejects.toThrow(/follow/) // one removed AND one added
    expect(fake.signRequests).toBe(0) // none of that reached the signer
    const { event } = await signer.sign(add, 5000, undefined, { followBase: base }); expect(event.kind).toBe(3); expect(event.tags).toEqual([...base.tags, ['p', 'c'.repeat(64)]]); expect(fake.signRequests).toBe(1)
  }, 40_000)

  it('discards a signer that alters the content or signs with another key', async () => {
    const t = await connected({ tamper: true })
    await expect(t.signer.sign(note(), 5000)).rejects.toThrow(/differs from what was asked/)
    const g = await connected({ tamperTags: true })
    await expect(g.signer.sign(note(), 5000)).rejects.toThrow(/differs from what was asked/)
    const w = await connected({ wrongKey: true })
    await expect(w.signer.sign(note(), 5000)).rejects.toThrow(/differs from what was asked|not signed/)
  }, 40_000)

  it('a rejection, and a signer that never answers, end in a clear error and nothing signed', async () => {
    const r = await connected({ decision: 'reject' })
    await expect(r.signer.sign(note(), 5000)).rejects.toThrow(/rejected/)
    const s = await connected({ decision: 'ignore' })
    await expect(s.signer.sign(note(), 800)).rejects.toThrow(/did not answer within/)
  }, 40_000)

  it('stop waiting for a signature: rejects at once, and the late answer is ignored', async () => {
    const { signer, fake } = await connected({ decision: 'ignore' })
    const ac = new AbortController(); setTimeout(() => ac.abort(), 150)
    const t0 = Date.now()
    await expect(signer.sign(note(), 20_000, ac.signal)).rejects.toThrow(/cancelled/)
    expect(Date.now() - t0).toBeLessThan(3000); expect(fake.signRequests).toBe(1)
    await expect(signer.sign(note(), 20_000, AbortSignal.abort())).rejects.toThrow(/cancelled/) // already cancelled: does not even wait
  }, 30_000)

  it('ping is true only on a real pong; silence is false; reconnect replaces a dead connection', async () => {
    const { signer, fake } = await connected()
    expect(await signer.ping(3000)).toBe(true); expect(await signer.awake(3000)).toBe(true)
    fake.behaviour.silentToPing = true
    expect(await signer.ping(600)).toBe(false); expect(await signer.awake(600)).toBe(false)
    fake.behaviour.silentToPing = false
    expect(await signer.reconnect(3000)).toBe(true)
    expect((await signer.sign(note('after reconnect'), 5000)).event.content).toBe('after reconnect')
  }, 40_000)

  it('a saved session resumes in a new page load; disconnect forgets the app key', async () => {
    const { signer, fake, store } = await connected()
    const kept = store.m.get('signer')!
    const reloaded = new Signer({ kv: mem().kv, relays: [relay.url], timeouts: { resumeMs: 6000, attemptMs: 2000 } }); signers.push(reloaded)
    expect(reloaded.hasSavedSession()).toBe(false)
    const again = mem(); again.m.set('signer', kept)
    const page2 = new Signer({ kv: again.kv, relays: [relay.url], timeouts: { resumeMs: 6000, attemptMs: 2000 } }); signers.push(page2)
    expect(page2.hasSavedSession()).toBe(true)
    expect(await page2.resume()).toBe(true); expect(page2.pubkey).toBe(fake.userPk)
    await signer.disconnect()
    expect(store.m.has('signer')).toBe(false); expect(signer.state).toBe('disconnected'); expect(signer.hasSavedSession()).toBe(false)
  }, 40_000)

  it('cancelling a pending connection is immediate, shows no error, and a new attempt still works', async () => {
    const s = new Signer({ kv: mem().kv, relays: [relay.url], timeouts: { connectMs: 8000, identityMs: 5000 } }); signers.push(s)
    const first = s.startConnect(); expect(s.state).toBe('connecting')
    const t0 = Date.now(); await s.disconnect(); expect(Date.now() - t0).toBeLessThan(2000)
    expect(await first.done).toBe(false); expect(s.state).toBe('disconnected'); expect(s.lastError).toBeUndefined()
    const fake = new FakeSigner({ delayMs: 20 }); fakes.push(fake)
    const again = s.startConnect(); await fake.scan(again.uri)
    expect(await again.done).toBe(true); expect(s.pubkey).toBe(fake.userPk)
  }, 30_000)

  it('resuming a session saved by this version is instant and asks the signer NOTHING; the first signature still works', async () => {
    const { fake, store } = await connected()
    const saved = JSON.parse(store.m.get('signer')!); expect(saved.userPubkey).toBe(fake.userPk)
    const asked = fake.seen.length; fake.behaviour.silentAboutIdentity = true // even a signer that would not tell us who it is
    const again = mem(); again.m.set('signer', store.m.get('signer')!)
    const page2 = new Signer({ kv: again.kv, relays: [relay.url] }); signers.push(page2)
    const t0 = Date.now(); expect(await page2.resume()).toBe(true)
    expect(Date.now() - t0).toBeLessThan(500); expect(page2.state).toBe('connected'); expect(page2.pubkey).toBe(fake.userPk)
    expect(fake.seen.length).toBe(asked) // nothing was sent
    expect((await page2.sign(note('first after reload'), 8000)).event.content).toBe('first after reload')
  }, 30_000)

  it('a wrong saved key cannot make Quill publish as someone else: the signature is refused', async () => {
    const { fake, store } = await connected()
    const forged = JSON.parse(store.m.get('signer')!); forged.userPubkey = getPublicKey(generateSecretKey())
    const again = mem(); again.m.set('signer', JSON.stringify(forged))
    const page2 = new Signer({ kv: again.kv, relays: [relay.url] }); signers.push(page2)
    expect(await page2.resume()).toBe(true); expect(page2.pubkey).not.toBe(fake.userPk)
    await expect(page2.sign(note(), 8000)).rejects.toThrow(/not signed by the connected key|differs from what was asked/)
  }, 30_000)

  it('a session saved by an older version resumes at once using the account being read as, and is upgraded by the first real signature', async () => {
    const { fake, store } = await connected()
    const old = JSON.parse(store.m.get('signer')!); delete old.userPubkey
    const again = mem(); again.m.set('signer', JSON.stringify(old))
    fake.behaviour.silentAboutIdentity = true
    const page2 = new Signer({ kv: again.kv, relays: [relay.url] }); signers.push(page2)
    const t0 = Date.now(); expect(await page2.resume(fake.userPk)).toBe(true)
    expect(Date.now() - t0).toBeLessThan(500); expect(page2.pubkey).toBe(fake.userPk)
    expect(JSON.parse(again.m.get('signer')!).userPubkey).toBeUndefined() // not trusted yet
    await page2.sign(note('first after upgrade'), 8000)
    expect(JSON.parse(again.m.get('signer')!).userPubkey).toBe(fake.userPk) // confirmed by a signature, now saved
  }, 30_000)

  it('a WRONG hint is refused at the first signature and never saved', async () => {
    const { fake, store } = await connected()
    const old = JSON.parse(store.m.get('signer')!); delete old.userPubkey
    const again = mem(); again.m.set('signer', JSON.stringify(old))
    const page2 = new Signer({ kv: again.kv, relays: [relay.url] }); signers.push(page2)
    expect(await page2.resume(getPublicKey(generateSecretKey()))).toBe(true)
    await expect(page2.sign(note(), 8000)).rejects.toThrow(/not signed by the connected key|differs from what was asked/)
    expect(JSON.parse(again.m.get('signer')!).userPubkey).toBeUndefined(); void fake
  }, 30_000)

  it('resume with nobody answering gives up with a clear error and leaves the saved session intact', async () => {
    const store = mem(); store.m.set('signer', JSON.stringify({ clientSecret: Buffer.from(generateSecretKey()).toString('hex'), signerPubkey: getPublicKey(generateSecretKey()), relays: [relay.url] }))
    const s = new Signer({ kv: store.kv, relays: [relay.url], timeouts: { resumeMs: 1500, attemptMs: 700 } }); signers.push(s)
    expect(await s.resume()).toBe(false)
    expect(s.state).toBe('disconnected'); expect(s.lastError).toMatch(/did not answer/); expect(store.m.has('signer')).toBe(true)
  }, 20_000)

  it('connecting by bunker:// address, and refusing malformed or insecure ones', async () => {
    const store = mem(); const s = new Signer({ kv: store.kv, relays: [relay.url], allowLoopback: true, timeouts: { connectMs: 5000, identityMs: 4000 } }); signers.push(s)
    const key = 'a'.repeat(64)
    for (const bad of ['hello', 'bunker://nothex?relay=wss://x.example', `bunker://${key}`, `bunker://${key}?relay=ws://insecure.example`, `bunker://${key}?relay=http://x.example`, 'nostr+walletconnect://x']) {
      expect(await s.connectBunker(bad), bad).toBe(false); expect(s.lastError, bad).toBeTruthy()
    }
    const strict = new Signer({ kv: mem().kv, relays: [relay.url] }); signers.push(strict) // without the test switch, ws:// is refused even on loopback
    expect(await strict.connectBunker(`bunker://${key}?relay=${encodeURIComponent(relay.url)}`)).toBe(false)
    expect(strict.lastError).toMatch(/at least one wss:\/\/ relay/)
    const fake = new FakeSigner({ delayMs: 20 }); fakes.push(fake)
    // the app key is created on the first real attempt; the fake must know it, so pre-seed it
    const sk = generateSecretKey(); store.m.set('signer', JSON.stringify({ clientSecret: Buffer.from(sk).toString('hex') }))
    await fake.listen([relay.url], getPublicKey(sk))
    expect(await s.connectBunker(`bunker://${fake.signerPk}?relay=${encodeURIComponent(relay.url)}`)).toBe(true)
    expect(s.pubkey).toBe(fake.userPk)
  }, 40_000)
})
