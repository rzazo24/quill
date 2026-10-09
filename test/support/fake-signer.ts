// A pretend NIP-46 signer (what Clave or a bunker does), speaking the real protocol — NIP-44 over kind-24133 events — through a real relay.
// It lets the tests exercise every way a signer can behave: approve like a person (after a delay), approve instantly (always allow), reject,
// never answer, or misbehave (alter the event, sign with the wrong key).
import { finalizeEvent, generateSecretKey, getPublicKey, nip44, type Event } from 'nostr-tools'
import WebSocket from 'ws'

export interface Behaviour {
  /** Milliseconds before answering a sign_event (a person takes a while; "always allow" answers at once). */
  delayMs: number
  decision: 'approve' | 'reject' | 'ignore'
  /** Change the content of what it signs. */
  tamper?: boolean
  /** Add a tag the client did not ask for (a hidden mention, say). */
  tamperTags?: boolean
  /** Sign with a different key than the one it announced. */
  wrongKey?: boolean
  /** Accept the connection but never answer get_public_key (a signer app suspended in the background). */
  silentAboutIdentity?: boolean
  /** Do not answer `ping` (a signer app suspended in the background). */
  silentToPing?: boolean
  /** Answer `ping` with an error instead of "pong" (a signer that does not know the method: it is awake, though). */
  pingError?: boolean
}

export class FakeSigner {
  readonly signerSk = generateSecretKey()
  readonly signerPk = getPublicKey(this.signerSk)
  readonly userSk = generateSecretKey()
  readonly userPk = getPublicKey(this.userSk)
  /** Every request received, in order. */
  readonly seen: { method: string; params: string[] }[] = []
  private sockets: WebSocket[] = []
  behaviour: Behaviour

  constructor(behaviour: Partial<Behaviour> = {}) { this.behaviour = { delayMs: 300, decision: 'approve', ...behaviour } }

  get signRequests() { return this.seen.filter((s) => s.method === 'sign_event').length }

  /** "Scans" a nostrconnect:// link: listens for requests on the link's relays and sends the connect response carrying the secret. */
  async scan(uri: string): Promise<{ perms: string[]; relays: string[]; name: string }> {
    const u = new URL(uri)
    const clientPk = u.hostname
    const relays = u.searchParams.getAll('relay')
    const secret = u.searchParams.get('secret')!
    await this.listen(relays, clientPk)
    await this.reply(clientPk, { id: Math.random().toString(36).slice(2), result: secret })
    return { perms: (u.searchParams.get('perms') ?? '').split(',').filter(Boolean), relays, name: u.searchParams.get('name') ?? '' }
  }

  /** Listens as a bunker for a client that already knows us (used to resume a saved session). */
  async listen(relays: string[], clientPk: string): Promise<void> {
    this.clientPk = clientPk
    for (const url of relays) {
      const ws = new WebSocket(url)
      this.sockets.push(ws)
      await new Promise<void>((resolve, reject) => { ws.on('open', () => resolve()); ws.on('error', reject) })
      ws.on('message', (raw) => { void this.onMessage(JSON.parse(String(raw))) })
      ws.send(JSON.stringify(['REQ', 'signer', { kinds: [24133], '#p': [this.signerPk], limit: 0 }]))
    }
    await new Promise((r) => setTimeout(r, 150)) // let the subscriptions settle
  }

  private clientPk = ''

  private async onMessage(msg: unknown[]) {
    if (msg[0] !== 'EVENT' || msg[1] !== 'signer') return
    const ev = msg[2] as Event
    let req: { id: string; method: string; params: string[] }
    try { req = JSON.parse(nip44.decrypt(ev.content, nip44.getConversationKey(this.signerSk, ev.pubkey))) } catch { return }
    this.clientPk = ev.pubkey
    this.seen.push({ method: req.method, params: req.params })
    switch (req.method) {
      case 'connect': return this.reply(ev.pubkey, { id: req.id, result: 'ack' })
      case 'ping':
        if (this.behaviour.silentToPing) return undefined
        return this.reply(ev.pubkey, this.behaviour.pingError ? { id: req.id, error: 'unsupported method ping' } : { id: req.id, result: 'pong' })
      case 'get_public_key': return this.behaviour.silentAboutIdentity ? undefined : this.reply(ev.pubkey, { id: req.id, result: this.userPk })
      case 'sign_event': {
        const b = this.behaviour
        if (b.decision === 'ignore') return
        await new Promise((r) => setTimeout(r, b.delayMs))
        if (b.decision === 'reject') return this.reply(ev.pubkey, { id: req.id, error: 'user rejected the request' })
        const t = JSON.parse(req.params[0]!)
        if (b.tamperTags) t.tags = [...t.tags, ['p', 'b'.repeat(64)]]
        if (b.tamper) t.content = `${t.content} (edited by the signer)`
        const signed = finalizeEvent(t, b.wrongKey ? generateSecretKey() : this.userSk)
        return this.reply(ev.pubkey, { id: req.id, result: JSON.stringify(signed) })
      }
      default: return this.reply(ev.pubkey, { id: req.id, error: `unsupported method ${req.method}` })
    }
  }

  private async reply(clientPk: string, body: { id: string; result?: string; error?: string }) {
    const content = nip44.encrypt(JSON.stringify(body), nip44.getConversationKey(this.signerSk, clientPk))
    const ev = finalizeEvent({ kind: 24133, created_at: Math.floor(Date.now() / 1000), tags: [['p', clientPk]], content }, this.signerSk)
    for (const ws of this.sockets) if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(['EVENT', ev]))
  }

  async stop() {
    for (const ws of this.sockets) { try { ws.close() } catch { /* closed */ } }
    this.sockets = []
  }
}
