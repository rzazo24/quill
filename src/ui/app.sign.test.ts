// @vitest-environment happy-dom
import type { Event } from 'nostr-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { ev, pk } from '../core/testutil.js'
import { answers, type Fetcher } from '../net/fetcher.js'
import type { Publisher } from '../net/publisher.js'
import type { SignerApi } from '../sign/pipeline.js'
import { startApp } from './app.js'

const me = pk('1'), friend = pk('a'), other = pk('9')
const list = (owner: string, kind: number, tags: string[][]) => ev(owner, '', { kind, tags })
const post = ev(friend, 'a post <b>from</b> my friend', { created_at: 1_699_999_000 })
const world: Event[] = [list(me, 3, [['p', friend]]), list(friend, 3, []), post]
const relays = (events: Event[]): Fetcher => ({ query: async (f) => events.filter((e) => answers(f, e)).slice(0, f.limit ?? 1000) })
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms))
const roots: HTMLElement[] = []
const btn = (root: HTMLElement, text: string) => [...root.querySelectorAll('button, a')].find((b) => b.textContent === text) as HTMLElement | undefined
const click = async (root: HTMLElement, text: string) => { const b = btn(root, text); if (!b) throw new Error(`no button "${text}" in: ${root.textContent?.slice(0, 200)}`); b.click(); await tick() }

/** A signer that does what the test tells it to: connects when asked, signs (or not), and records what it was asked. */
function fakeSigner(over: { pubkey?: string; awake?: boolean; signError?: string; saved?: boolean } = {}) {
  const listeners: (() => void)[] = []
  const log: string[] = []
  const s = {
    state: 'disconnected' as 'disconnected' | 'connecting' | 'connected', pubkey: undefined as string | undefined, lastError: undefined as string | undefined, authUrl: undefined,
    onChange: (cb: () => void) => void listeners.push(cb),
    hasSavedSession: () => over.saved ?? false,
    startConnect: () => { log.push('startConnect'); s.state = 'connecting'; return { uri: 'nostrconnect://abc?relay=wss%3A%2F%2Fr.example', claveLink: 'https://clave.casa/connect/?uri=nostrconnect%3A%2F%2Fabc', done: Promise.resolve(true) } },
    connectBunker: async (x: string) => { log.push('bunker ' + x); s.state = 'disconnected'; s.lastError = 'nope'; return false },
    resume: async () => true,
    awake: async () => over.awake ?? true,
    sign: async (t: { kind: number; content: string; tags: string[][]; created_at: number }) => {
      log.push('sign ' + t.kind)
      if (over.signError) throw new Error(over.signError)
      return { event: { ...ev(over.pubkey ?? me, t.content, { kind: t.kind, tags: t.tags, created_at: t.created_at }) }, ms: 700 }
    },
    disconnect: async () => { log.push('disconnect'); s.state = 'disconnected'; s.pubkey = undefined; listeners.forEach((l) => l()) },
    /** The user approves the connection in Clave. */
    approve: (pubkey = over.pubkey ?? me) => { s.state = 'connected'; s.pubkey = pubkey; listeners.forEach((l) => l()) },
  }
  return { s: s as unknown as SignerApi, raw: s, log }
}
const publisherFake = (outcomes: Record<string, string> = { 'wss://r1.example': 'ok', 'wss://r2.example': 'ok' }) => {
  const sent: { event: Event; only?: string[] }[] = []
  const p: Publisher = { publish: async (event, only) => { sent.push({ event, only }); return only ? Object.fromEntries(only.map((u) => [u, 'ok'])) : outcomes } }
  return { p, sent }
}

function boot(o: { signer?: ReturnType<typeof fakeSigner>; pub?: ReturnType<typeof publisherFake>; stored?: Record<string, string> } = {}) {
  const root = document.createElement('div'); document.body.append(root); roots.push(root)
  const location = { hash: '' }, mem = new Map(Object.entries(o.stored ?? { me }))
  const pub = o.pub ?? publisherFake()
  startApp(root, {
    fetcher: relays(world), languages: ['en'], location, onHash: () => {}, setHash: () => {}, relays: ['wss://r1.example', 'wss://r2.example'], nowMs: () => 1_700_000_000_000,
    storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) },
    ...(o.signer ? { signer: o.signer.s, publisher: pub.p } : {}),
  })
  return { root, mem, pub, text: () => root.textContent ?? '' }
}
afterEach(() => { roots.forEach((r) => r.remove()); roots.length = 0 })

describe('without a signer the app stays read-only', () => {
  it('shows no connect button, no reply, no reactions', async () => {
    const a = boot(); await tick(100)
    expect(a.text()).toContain('a post <b>from</b> my friend')
    expect(a.root.querySelector('.sign, .actions')).toBeNull()
  })
})

describe('connecting Clave', () => {
  it('offers a link for Clave, then shows who you are signing as, and reactions appear', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg }); await tick(100)
    expect(a.root.querySelector('.actions')).toBeNull() // not connected: nothing to click
    await click(a.root, 'Connect Clave')
    expect(sg.log).toContain('startConnect')
    expect(a.root.querySelector('a.button')!.getAttribute('href')).toMatch(/^https:\/\/clave\.casa\/connect\/\?uri=/)
    expect(a.text()).toContain('Waiting for Clave')
    sg.raw.approve(); await tick(100)
    expect(a.text()).toContain('Signing as'); expect(a.root.querySelectorAll('.actions').length).toBeGreaterThan(0)
  })
  it('a signer for ANOTHER account is refused and disconnected', async () => {
    const sg = fakeSigner({ pubkey: other }); const a = boot({ signer: sg }); await tick(100)
    await click(a.root, 'Connect Clave'); sg.raw.approve(); await tick(100)
    expect(sg.log).toContain('disconnect'); expect(a.text()).toMatch(/belongs to another account/); expect(a.text()).not.toContain('Signing as')
    expect(a.root.querySelector('.actions')).toBeNull()
  })
  it('connecting from the login screen makes the signer\'s key the reader', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg, stored: {} })
    expect(a.text()).toContain('Read as…'); await click(a.root, 'Connect Clave'); sg.raw.approve(); await tick(120)
    expect(a.mem.get('me')).toBe(me); expect(a.text()).toContain('a post <b>from</b> my friend')
  })
  it('a failed bunker:// connection shows why', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg }); await tick(100)
    await click(a.root, 'Connect Clave')
    const input = a.root.querySelector('.connect input') as HTMLInputElement; input.value = 'bunker://x'
    a.root.querySelector('.connect form')!.dispatchEvent(new Event('submit', { cancelable: true })); await tick(60)
    expect(a.text()).toMatch(/Could not connect: nope/)
  })
})

describe('reacting, one tap', () => {
  it('signs and publishes a kind 7 with the right tags, and says where it went', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg }); await tick(100); await click(a.root, 'Connect Clave'); sg.raw.approve(); await tick(100)
    ;(a.root.querySelector('button[aria-label="React ❤️"]') as HTMLElement).click(); await tick(80)
    expect(a.pub.sent).toHaveLength(1)
    const e = a.pub.sent[0]!.event
    expect(e.kind).toBe(7); expect(e.content).toBe('❤️')
    expect(e.tags).toEqual([['e', post.id], ['p', friend], ['k', '1']])
    expect(a.text()).toContain('Published to 2 of 2 relays')
  })
})

describe('writing a reply', () => {
  async function toReview(sg = fakeSigner(), text = 'Thanks! #nostr nostr:' + 'npub1' + 'x'.repeat(5)) {
    const a = boot({ signer: sg }); await tick(100); await click(a.root, 'Connect Clave'); sg.raw.approve(); await tick(100)
    await click(a.root, 'Reply')
    const ta = a.root.querySelector('textarea') as HTMLTextAreaElement; ta.value = text; ta.dispatchEvent(new Event('input'))
    await click(a.root, 'Review')
    return a
  }
  it('shows exactly what will be signed before anything is asked of Clave', async () => {
    const sg = fakeSigner(); const a = await toReview(sg, 'Thanks <script>x</script> #nostr')
    expect(a.text()).toContain('You are about to publish as'); expect(a.root.querySelector('pre.preview')!.textContent).toBe('Thanks <script>x</script> #nostr')
    expect(a.root.querySelector('.sign script')).toBeNull(); expect(a.text()).toMatch(/In reply to/); expect(a.text()).toMatch(/Sent to 2 relays/)
    expect(sg.log.filter((l) => l.startsWith('sign'))).toEqual([]) // nothing signed yet
    expect(a.pub.sent).toEqual([])
  })
  it('Publish signs a kind 1 with correct thread tags and publishes it', async () => {
    const sg = fakeSigner(); const a = await toReview(sg, 'Thanks #nostr')
    await click(a.root, 'Publish'); await tick(60)
    const e = a.pub.sent[0]!.event
    expect(e.kind).toBe(1); expect(e.content).toBe('Thanks #nostr')
    expect(e.tags).toEqual([['e', post.id, '', 'root'], ['p', friend], ['t', 'nostr']])
    expect(a.text()).toContain('Published to 2 of 2 relays'); expect(a.root.querySelector('textarea')).toBeNull()
    await click(a.root, 'Close') // the old draft must not come back once the result is dismissed
    expect(a.root.querySelector('textarea')).toBeNull(); expect(a.root.querySelector('pre.preview')).toBeNull()
  })
  it('Back returns to the editor with the text intact', async () => {
    const a = await toReview(fakeSigner(), 'my draft'); await click(a.root, 'Back')
    expect((a.root.querySelector('textarea') as HTMLTextAreaElement).value).toBe('my draft')
  })
  it('empty and over-long notes are stopped at the review, with a reason', async () => {
    const a = await toReview(fakeSigner(), '   '); expect(a.text()).toContain('The note is empty.'); expect(a.root.querySelector('pre.preview')).toBeNull()
    const ta = a.root.querySelector('textarea') as HTMLTextAreaElement; ta.value = 'x'.repeat(1001); ta.dispatchEvent(new Event('input')); await click(a.root, 'Review')
    expect(a.text()).toMatch(/too long \(limit 1000/)
  })
  it('a sleeping Clave: clear message, nothing signed or published, and the draft is kept', async () => {
    const sg = fakeSigner({ awake: false }); const a = await toReview(sg); await click(a.root, 'Publish'); await tick(40)
    expect(a.text()).toMatch(/Clave did not answer/); expect(a.pub.sent).toEqual([]); expect(sg.log.some((l) => l.startsWith('sign'))).toBe(false)
    expect(a.root.querySelector('pre.preview')).not.toBeNull()
  })
  it('a rejection in Clave publishes nothing', async () => {
    const a = await toReview(fakeSigner({ signError: 'user rejected the request' })); await click(a.root, 'Publish'); await tick(40)
    expect(a.text()).toMatch(/Clave did not sign: user rejected the request. Nothing was published/); expect(a.pub.sent).toEqual([])
  })
  it('relays that failed can be retried without signing again', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg, pub: publisherFake({ 'wss://r1.example': 'ok', 'wss://r2.example': 'no answer from the relay' }) })
    await tick(100); await click(a.root, 'Connect Clave'); sg.raw.approve(); await tick(100)
    ;(a.root.querySelector('button[aria-label="React +"]') as HTMLElement).click(); await tick(80)
    expect(a.text()).toContain('Published to 1 of 2 relays'); expect(a.text()).toContain('no answer from the relay')
    await click(a.root, 'Retry the failed relays'); await tick(40)
    expect(a.pub.sent).toHaveLength(2); expect(a.pub.sent[1]!.only).toEqual(['wss://r2.example']); expect(a.pub.sent[1]!.event.id).toBe(a.pub.sent[0]!.event.id)
    expect(sg.log.filter((l) => l.startsWith('sign'))).toHaveLength(1); expect(a.text()).toContain('Published to 2 of 2 relays')
  })
})

describe('signing out', () => {
  it('disconnects the signer too', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg }); await tick(100); await click(a.root, 'Connect Clave'); sg.raw.approve(); await tick(100)
    await click(a.root, 'Sign out'); expect(sg.log).toContain('disconnect'); expect(a.mem.has('me')).toBe(false)
  })
})
