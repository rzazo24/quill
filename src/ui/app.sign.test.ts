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

/** Connecting lives on the Me page now: go there, connect, and come back to the feed where the notes (and their reaction buttons) are. */
async function connectClave(a: ReturnType<typeof boot>, sg: ReturnType<typeof fakeSigner>) {
  await a.go('#/me'); await click(a.root, 'Connect Clave'); sg.raw.approve(); await tick(100); await a.go('#/')
}

/** A signer that does what the test tells it to: connects when asked, signs (or not), and records what it was asked. */
function fakeSigner(over: { pubkey?: string; signError?: string; saved?: boolean; hang?: boolean; hangFirst?: boolean } = {}) {
  let signCalls = 0
  const listeners: (() => void)[] = []
  const log: string[] = []
  const s = {
    state: 'disconnected' as 'disconnected' | 'connecting' | 'connected', pubkey: undefined as string | undefined, lastError: undefined as string | undefined, authUrl: undefined,
    onChange: (cb: () => void) => void listeners.push(cb),
    hasSavedSession: () => over.saved ?? false,
    startConnect: () => { log.push('startConnect'); s.state = 'connecting'; return { uri: 'nostrconnect://abc?relay=wss%3A%2F%2Fr.example', claveLink: 'https://clave.casa/connect/?uri=nostrconnect%3A%2F%2Fabc', done: Promise.resolve(true) } },
    connectBunker: async (x: string) => { log.push('bunker ' + x); s.state = 'disconnected'; s.lastError = 'nope'; return false },
    resume: async () => true,
    sign: async (t: { kind: number; content: string; tags: string[][]; created_at: number }, _ms?: number, signal?: AbortSignal) => {
      log.push('sign ' + t.kind)
      signCalls++
      if (over.hang || (over.hangFirst && signCalls === 1)) await new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new Error('cancelled'))))
      if (over.signError) throw new Error(over.signError)
      return { event: { ...ev(over.pubkey ?? me, t.content, { kind: t.kind, tags: t.tags, created_at: t.created_at }) }, ms: 700 }
    },
    disconnect: async () => { log.push('disconnect'); s.state = 'disconnected'; s.pubkey = undefined; listeners.forEach((l) => l()) },
    /** The user approves the connection in Clave. */
    approve: (pubkey = over.pubkey ?? me) => { s.state = 'connected'; s.pubkey = pubkey; listeners.forEach((l) => l()) },
  }
  return { s: s as unknown as SignerApi, raw: s, log }
}
const publisherFake = (outcomes: Record<string, string> = { 'wss://r1.example': 'ok', 'wss://r2.example': 'ok' }, delayMs = 0) => {
  const sent: { event: Event; only?: string[] }[] = []
  const p: Publisher = { publish: async (event, only) => { if (delayMs) await new Promise((r) => setTimeout(r, delayMs)); sent.push({ event, only }); return only ? Object.fromEntries(only.map((u) => [u, 'ok'])) : outcomes } }
  return { p, sent }
}

function boot(o: { events?: Event[]; signer?: ReturnType<typeof fakeSigner>; pub?: ReturnType<typeof publisherFake>; stored?: Record<string, string>; clipboard?: string | Error } = {}) {
  const root = document.createElement('div'); document.body.append(root); roots.push(root)
  const location = { hash: '' }, listeners: (() => void)[] = [], mem = new Map(Object.entries(o.stored ?? { me }))
  const pub = o.pub ?? publisherFake()
  startApp(root, {
    fetcher: relays(o.events ?? world), languages: ['en'], location, onHash: (cb) => listeners.push(cb), setHash: (h) => { location.hash = h; listeners.forEach((l) => l()) }, relays: ['wss://r1.example', 'wss://r2.example'], nowMs: () => 1_700_000_000_000,
    storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) },
    readClipboard: async () => { if (o.clipboard instanceof Error) throw o.clipboard; return o.clipboard ?? '' },
    ...(o.signer ? { signer: o.signer.s, publisher: pub.p } : {}),
  })
  const go = async (hash: string) => { location.hash = hash; listeners.forEach((l) => l()); await tick(60) }
  return { root, mem, pub, go, text: () => root.textContent ?? '' }
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
    await a.go('#/me'); await click(a.root, 'Connect Clave') // opens the panel: the bunker:// address comes first, nothing is started yet
    expect(sg.log).not.toContain('startConnect'); expect(a.text()).toContain('Recommended: paste the bunker address from Clave')
    expect(a.root.querySelector('a.button')).toBeNull()
    await click(a.root, 'Connect Clave') // the alternative, inside "Use a link instead"
    expect(sg.log).toContain('startConnect')
    expect(a.root.querySelector('a.button')!.getAttribute('href')).toMatch(/^https:\/\/clave\.casa\/connect\/\?uri=/)
    // it must open in a NEW tab: leaving this page would throw away the pending connection that Clave is about to answer
    expect(a.root.querySelector('a.button')!.getAttribute('target')).toBe('_blank'); expect(a.root.querySelector('a.button')!.getAttribute('rel')).toBe('noopener noreferrer')
    expect(a.text()).toContain('Waiting for Clave')
    sg.raw.approve(); await tick(100)
    expect(a.text()).toContain('Signing as')
    await a.go('#/'); expect(a.root.querySelectorAll('.actions').length).toBeGreaterThan(0) // on the reading pages the notes now carry reply and reactions
  })
  it('a signer for ANOTHER account is refused and disconnected', async () => {
    const sg = fakeSigner({ pubkey: other }); const a = boot({ signer: sg }); await tick(100)
    await connectClave(a, sg)
    expect(sg.log).toContain('disconnect'); expect(a.text()).toMatch(/belongs to another account/); expect(a.text()).not.toContain('Signing as')
    expect(a.root.querySelector('.actions')).toBeNull()
  })
  it('connecting from the login screen makes the signer\'s key the reader', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg, stored: {} })
    expect(a.text()).toContain('Read as…'); await click(a.root, 'Connect Clave'); sg.raw.approve(); await tick(120); await a.go('#/')
    expect(a.mem.get('me')).toBe(me); expect(a.text()).toContain('a post <b>from</b> my friend')
  })
  it('a failed bunker:// connection shows why', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg }); await tick(100)
    await a.go('#/me'); await click(a.root, 'Connect Clave')
    const input = a.root.querySelector('.connect input') as HTMLInputElement; input.value = 'bunker://x'
    a.root.querySelector('.connect form')!.dispatchEvent(new Event('submit', { cancelable: true })); await tick(60)
    expect(a.text()).toMatch(/Could not connect: nope/)
  })
})

describe('pasting the bunker:// address from Clave', () => {
  it('the paste button reads the clipboard and connects with the bunker address', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg, clipboard: 'bunker://' + 'a'.repeat(64) + '?relay=wss%3A%2F%2Frelay.powr.build&secret=s' }); await tick(100)
    await a.go('#/me'); await click(a.root, 'Connect Clave'); await click(a.root, 'Paste and connect')
    expect(sg.log.some((l) => l.startsWith('bunker bunker://'))).toBe(true)
  })
  it('a clipboard that is not a bunker address is refused with a message, and nothing is sent anywhere', async () => {
    for (const clip of ['', 'hello world', 'nostrconnect://abc', 'https://example.com', new Error('permission denied')]) {
      const sg = fakeSigner(); const a = boot({ signer: sg, clipboard: clip }); await tick(100)
      await a.go('#/me'); await click(a.root, 'Connect Clave'); await click(a.root, 'Paste and connect')
      expect(a.text(), String(clip)).toContain('does not hold a bunker:// address'); expect(sg.log.some((l) => l.startsWith('bunker'))).toBe(false)
    }
  })
  it('the typed address still works, and a failure says why', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg }); await tick(100); await a.go('#/me'); await click(a.root, 'Connect Clave')
    const input = a.root.querySelector('.bunker input') as HTMLInputElement; input.value = 'bunker://x'
    a.root.querySelector('.bunker form')!.dispatchEvent(new Event('submit', { cancelable: true })); await tick(60)
    expect(a.text()).toMatch(/Could not connect: nope/)
  })
})

describe('the connect panel survives redraws', () => {
  it('what was typed in the bunker field and the opened "use a link" section are still there after the page redraws', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg }); await tick(100); await a.go('#/me'); await click(a.root, 'Connect Clave')
    const input = a.root.querySelector('.bunker input') as HTMLInputElement; input.value = 'bunker://half-typed'; input.dispatchEvent(new Event('input'))
    const det = a.root.querySelector('details.by-link') as HTMLDetailsElement; det.open = true; det.dispatchEvent(new Event('toggle'))
    ;[...a.root.querySelectorAll('.lang button')].find((b) => b.textContent === 'ES')!.dispatchEvent(new Event('click')); await tick(100) // anything that redraws the page
    expect((a.root.querySelector('.bunker input') as HTMLInputElement).value).toBe('bunker://half-typed')
    expect((a.root.querySelector('details.by-link') as HTMLDetailsElement).open).toBe(true)
  })
})

describe('reacting, one tap', () => {
  it('signs and publishes a kind 7 with the right tags, and says where it went', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg }); await tick(100); await connectClave(a, sg)
    ;(a.root.querySelector('button[aria-label="React ❤️"]') as HTMLElement).click(); await tick(80)
    expect(a.pub.sent).toHaveLength(1)
    const e = a.pub.sent[0]!.event
    expect(e.kind).toBe(7); expect(e.content).toBe('❤️')
    expect(e.tags).toEqual([['e', post.id], ['p', friend], ['k', '1']])
    expect(a.text()).toContain('❤️ → '); expect(a.text()).not.toContain('Published to')
  })
})

describe('what you already did to a note is marked', () => {
  const bar = (a: ReturnType<typeof boot>) => a.root.querySelector('.actions') as HTMLElement
  const lit = (a: ReturnType<typeof boot>) => [...bar(a).querySelectorAll('button.react.on')].map((b) => b.textContent)
  it('reactions and replies already on the relays (from here or from another app) are marked when the page opens', async () => {
    const mineReaction = ev(me, '❤️', { kind: 7, tags: [['e', post.id], ['p', friend], ['k', '1']] })
    const fromElsewhere = ev(me, '🔥', { kind: 7, tags: [['e', post.id], ['p', friend]] }) // an emoji this bar does not offer
    const myReply = ev(me, 'I answered this', { tags: [['e', post.id, '', 'root']] })
    const sg = fakeSigner(); const a = boot({ events: [...world, mineReaction, fromElsewhere, myReply], signer: sg }); await tick(100); await connectClave(a, sg)
    expect(lit(a)).toEqual(['❤️', '🔥']) // the ❤️ in its place; the 🔥 added at the end, lit
    expect(bar(a).querySelector('button.link.on')!.textContent).toBe('Replied'); expect(bar(a).querySelector('button.link.on svg.icon')).not.toBeNull()
    expect(bar(a).querySelector('button.react.on')!.getAttribute('aria-pressed')).toBe('true')
    expect(bar(a).querySelector('button[aria-label="React 👍"]')!.getAttribute('aria-pressed')).toBe('false') // the others are not
  })
  it('nothing is marked on a note you did nothing to', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg }); await tick(100); await connectClave(a, sg)
    expect(lit(a)).toEqual([]); expect(bar(a).querySelector('button.link.on')).toBeNull(); expect(bar(a).textContent).toContain('Reply')
  })
  it('a reaction given here is marked at once; tapping it again does NOT sign a second time', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg }); await tick(100); await connectClave(a, sg)
    ;(a.root.querySelector('button[aria-label="React ❤️"]') as HTMLElement).click(); await tick(120)
    expect(a.pub.sent).toHaveLength(1); expect(lit(a)).toEqual(['❤️'])
    ;(bar(a).querySelector('button.react.on') as HTMLElement).click(); await tick(120)
    expect(a.pub.sent).toHaveLength(1); expect(sg.log.filter((l) => l.startsWith('sign'))).toHaveLength(1) // nothing new asked of the signer
    expect(a.text()).toContain('You already reacted with ❤️ to this note.')
    ;(a.root.querySelector('button[aria-label="React 🙏"]') as HTMLElement).click(); await tick(120) // a different reaction is allowed
    expect(a.pub.sent).toHaveLength(2); expect(lit(a)).toEqual(['❤️', '🙏'])
  })
  it('a reaction that reached every relay shows one short line and no per-relay panel; the line fades by itself', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg }); await tick(100); await connectClave(a, sg)
    ;(a.root.querySelector('button[aria-label="React ❤️"]') as HTMLElement).click(); await tick(120)
    expect(a.root.querySelector('.toast')).toBeNull(); expect(a.root.querySelector('.popup')!.textContent).toMatch(/^❤️ → /)
    await tick(3100); expect(a.root.querySelector('.popup')).toBeNull()
  })
  it('a failed reaction is not marked (nothing was published)', async () => {
    const sg = fakeSigner({ signError: 'user rejected the request' }); const a = boot({ signer: sg }); await tick(100); await connectClave(a, sg)
    ;(a.root.querySelector('button[aria-label="React ❤️"]') as HTMLElement).click(); await tick(120)
    expect(lit(a)).toEqual([])
  })
  it('after you publish a reply, that note shows as replied', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg }); await tick(100); await connectClave(a, sg)
    await click(a.root, 'Reply'); const ta = a.root.querySelector('textarea') as HTMLTextAreaElement; ta.value = 'my answer'; ta.dispatchEvent(new Event('input'))
    await click(a.root, 'Review'); await click(a.root, 'Publish'); await tick(120)
    expect(a.pub.sent).toHaveLength(1); await a.go('#/'); await tick(80)
    expect(bar(a).querySelector('button.link.on')!.textContent).toBe('Replied')
  })
})

describe('tapping again while Clave has not answered', () => {
  it('a new tap replaces the old wait (so opening Clave and tapping again works): one request cancelled, one published', async () => {
    const sg = fakeSigner({ hangFirst: true }); const a = boot({ signer: sg }); await tick(100); await connectClave(a, sg)
    ;(a.root.querySelector('button[aria-label="React ❤️"]') as HTMLElement).click(); await tick(60)
    expect(a.text()).toMatch(/Waiting for Clave/); expect(a.pub.sent).toEqual([])
    ;(a.root.querySelector('button[aria-label="React 🤙"]') as HTMLElement).click(); await tick(120)
    expect(sg.log.filter((l) => l.startsWith('sign'))).toHaveLength(2)
    expect(a.pub.sent).toHaveLength(1); expect(a.pub.sent[0]!.event.content).toBe('🤙')
    expect(a.text()).toContain('🤙 → '); expect(a.text()).not.toContain('Cancelled')
  })
  it('once the signature exists and the event is being sent, a second tap is ignored: no double posts', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg, pub: publisherFake(undefined, 150) }); await tick(100); await connectClave(a, sg)
    ;(a.root.querySelector('button[aria-label="React ❤️"]') as HTMLElement).click(); await tick(60)
    ;(a.root.querySelector('button[aria-label="React 🤙"]') as HTMLElement).click(); await tick(300)
    expect(a.pub.sent).toHaveLength(1); expect(a.pub.sent[0]!.event.content).toBe('❤️'); expect(sg.log.filter((l) => l.startsWith('sign'))).toHaveLength(1)
  })
  it('waiting for the signer is a popup fixed to the screen that stays while it waits, can be cancelled, and goes away when it is over', async () => {
    const sg = fakeSigner({ hang: true }); const a = boot({ signer: sg }); await tick(100); await connectClave(a, sg)
    ;(a.root.querySelector('button[aria-label="React ❤️"]') as HTMLElement).click(); await tick(60)
    const pop = a.root.querySelector('.sign .popup.stay')!; expect(pop.textContent).toMatch(/Waiting for Clave/); expect(pop.querySelector('button')!.textContent).toBe('Cancel')
    await tick(3200); expect(a.root.querySelector('.sign .popup.stay')).not.toBeNull() // it does not fade away like a plain notice
    ;(pop.querySelector('button') as HTMLElement).click(); await tick(80)
    expect(a.root.querySelector('.sign .popup.stay')).toBeNull(); expect(a.pub.sent).toEqual([])
  })
})

describe('writing a reply', () => {
  async function toReview(sg = fakeSigner(), text = 'Thanks! #nostr nostr:' + 'npub1' + 'x'.repeat(5)) {
    const a = boot({ signer: sg }); await tick(100); await connectClave(a, sg)
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
  it('a Clave that never answers: clear message, nothing published, and the draft is kept', async () => {
    const sg = fakeSigner({ signError: 'the signer did not answer within 300 s' }); const a = await toReview(sg); await click(a.root, 'Publish'); await tick(40)
    expect(a.text()).toMatch(/Clave did not answer in time/); expect(a.pub.sent).toEqual([])
    expect(a.root.querySelector('pre.preview')).not.toBeNull()
  })
  it('while waiting for Clave there is a Cancel button: it stops the wait, publishes nothing, keeps the draft', async () => {
    const sg = fakeSigner({ hang: true }); const a = await toReview(sg); await click(a.root, 'Publish')
    expect(a.text()).toMatch(/Waiting for Clave… If it takes long, open Clave or tap its notification/); expect(sg.log.filter((l) => l.startsWith('sign'))).toHaveLength(1) // ONE request
    await click(a.root, 'Cancel'); await tick(30)
    expect(a.text()).toContain('Cancelled. Nothing was published.'); expect(a.pub.sent).toEqual([]); expect(a.root.querySelector('pre.preview')).not.toBeNull()
  })
  it('a rejection in Clave publishes nothing', async () => {
    const a = await toReview(fakeSigner({ signError: 'user rejected the request' })); await click(a.root, 'Publish'); await tick(40)
    expect(a.text()).toMatch(/Clave did not sign: user rejected the request. Nothing was published/); expect(a.pub.sent).toEqual([])
  })
  it('relays that failed can be retried without signing again', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg, pub: publisherFake({ 'wss://r1.example': 'ok', 'wss://r2.example': 'no answer from the relay' }) })
    await tick(100); await connectClave(a, sg)
    ;(a.root.querySelector('button[aria-label="React 👍"]') as HTMLElement).click(); await tick(80)
    expect(a.text()).toContain('Published to 1 of 2 relays'); expect(a.text()).toContain('no answer from the relay')
    await click(a.root, 'Retry the failed relays'); await tick(40)
    expect(a.pub.sent).toHaveLength(2); expect(a.pub.sent[1]!.only).toEqual(['wss://r2.example']); expect(a.pub.sent[1]!.event.id).toBe(a.pub.sent[0]!.event.id)
    expect(sg.log.filter((l) => l.startsWith('sign'))).toHaveLength(1); expect(a.text()).toContain('Published to 2 of 2 relays')
  })
})

describe('signing out', () => {
  it('disconnects the signer too', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg }); await tick(100); await connectClave(a, sg)
    await a.go('#/me'); await click(a.root, 'Sign out'); expect(sg.log).toContain('disconnect'); expect(a.mem.has('me')).toBe(false)
  })
})

describe('the relay list on Nostr', () => {
  const published = (urls: string[], at = 1000) => ev(me, '', { kind: 10002, created_at: at, tags: urls.map((u) => ['r', u]) })
  const prefs = (a: ReturnType<typeof boot>) => a.root.querySelector('.prefs') as HTMLElement
  const urls = (a: ReturnType<typeof boot>) => [...prefs(a).querySelectorAll('.relay-list .url')].map((x) => x.textContent)
  const press = async (a: ReturnType<typeof boot>, label: string) => { const b = [...prefs(a).querySelectorAll('button')].find((x) => x.textContent === label)!; b.click(); await tick(150) }
  const open = async (a: ReturnType<typeof boot>, sg?: ReturnType<typeof fakeSigner>) => { await tick(100); if (sg) await connectClave(a, sg); await a.go('#/settings'); await tick(100) }

  it('with nothing published, and a signer connected, the list can be published after a confirmation that says it is public', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg }); await open(a, sg)
    expect(prefs(a).textContent).toContain('You have not published your relay list on Nostr yet.')
    await press(a, 'Publish this list on Nostr'); expect(prefs(a).textContent).toContain('This is public'); expect(prefs(a).textContent).toContain('these 2 relays'); expect(a.pub.sent).toEqual([])
    await press(a, 'Cancel'); expect(prefs(a).textContent).not.toContain('This is public'); expect(a.pub.sent).toEqual([]) // nothing signed without the second step
    await press(a, 'Publish this list on Nostr'); await press(a, 'Sign and publish')
    expect(a.pub.sent).toHaveLength(1); const e = a.pub.sent[0]!.event
    expect(e.kind).toBe(10002); expect(e.content).toBe(''); expect(e.tags).toEqual([['r', 'wss://r1.example'], ['r', 'wss://r2.example']])
    expect(prefs(a).textContent).toContain('The relay list you published on Nostr is this one.'); expect(a.text()).toContain('Relay list published')
  })
  it('without a signer it says what is needed and offers nothing to press', async () => {
    const a = boot(); await open(a)
    expect(prefs(a).textContent).toContain('Connect Clave (in Me) to publish this list.'); expect([...prefs(a).querySelectorAll('button')].some((b) => b.textContent === 'Publish this list on Nostr')).toBe(false)
  })
  it('a different published list is reported, and can be used here instead', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg, events: [...world, published(['wss://x.example', 'wss://y.example', 'wss://z.example'])], stored: { me, relays: JSON.stringify(['wss://r1.example']) } }); await open(a, sg)
    expect(prefs(a).textContent).toContain('is different (relays: 3)')
    await press(a, 'Use the published list'); expect(urls(a)).toEqual(['x.example', 'y.example', 'z.example']); expect(JSON.parse(a.mem.get('relays')!)).toEqual(['wss://x.example', 'wss://y.example', 'wss://z.example'])
    expect(prefs(a).textContent).toContain('is this one.')
  })
  it('a device that never chose a list starts from the published one and keeps it as its own (the notice shows once); a device that chose keeps its own', async () => {
    const list = published(['wss://x.example', 'wss://y.example'])
    const fresh = boot({ signer: fakeSigner(), events: [...world, list] }); await open(fresh, undefined); expect(urls(fresh)).toEqual(['x.example', 'y.example']); expect(JSON.parse(fresh.mem.get('relays')!)).toEqual(['wss://x.example', 'wss://y.example']); expect(fresh.text()).toContain('Relays loaded from your list on Nostr (2).')
    const chosen = boot({ events: [...world, list], stored: { me, relays: JSON.stringify(['wss://r1.example']) } }); await open(chosen); expect(urls(chosen)).toEqual(['r1.example'])
  })
  it('somebody else\'s relay list is never adopted', async () => {
    const theirs = ev(friend, '', { kind: 10002, created_at: 1000, tags: [['r', 'wss://evil.example']] })
    const a = boot({ events: [...world, theirs] }); await open(a); expect(urls(a)).toEqual(['r1.example', 'r2.example'])
  })
})

describe('adopting the published relay list happens once', () => {
  it('the second start on the same device uses its own list, says nothing, and a later change on Nostr is offered, not forced', async () => {
    const first = boot({ signer: fakeSigner(), events: [...world, ev(me, '', { kind: 10002, created_at: 1000, tags: [['r', 'wss://x.example'], ['r', 'wss://y.example']] })] }); await tick(150)
    expect(first.text()).toContain('Relays loaded from your list on Nostr (2).')
    const stored = first.mem.get('relays')!
    const newer = ev(me, '', { kind: 10002, created_at: 2000, tags: [['r', 'wss://z.example']] })
    const second = boot({ signer: fakeSigner(), events: [...world, newer], stored: { me, relays: stored } }); await tick(150)
    expect(second.text()).not.toContain('Relays loaded from your list'); expect(second.mem.get('relays')).toBe(stored)
    await second.go('#/settings'); await tick(100); expect(second.root.querySelector('.prefs')!.textContent).toContain('is different (relays: 1)')
    expect([...second.root.querySelectorAll('.relay-list .url')].map((x) => x.textContent)).toEqual(['x.example', 'y.example'])
  })
})

describe('the write button', () => {
  const fab = (a: ReturnType<typeof boot>) => a.root.querySelector('button.fab') as HTMLButtonElement | null
  it('is a round button over the page, only with a signer connected, and nothing is left at the top of the feed', async () => {
    const out = boot({ signer: fakeSigner() }); await tick(100); expect(fab(out)).toBeNull() // not connected: nothing to write with
    const sg = fakeSigner(); const a = boot({ signer: sg }); await tick(100); await connectClave(a, sg); await a.go('#/'); await tick(80)
    expect(fab(a)).not.toBeNull(); expect(fab(a)!.getAttribute('aria-label')).toBe('Write a note'); expect(fab(a)!.querySelector('svg')).not.toBeNull(); expect(fab(a)!.textContent).toBe('')
    expect(a.root.querySelector('main.view .compose-start')).toBeNull(); expect(a.root.querySelector('.sheet')).toBeNull()
  })
  it('is on the reading pages and Me, not on Settings or Help', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg }); await tick(100); await connectClave(a, sg)
    for (const [hash, shown] of [['#/', true], ['#/mentions', true], ['#/me', true], ['#/settings', false], ['#/help', false]] as const) { await a.go(hash); await tick(80); expect(fab(a) !== null, hash).toBe(shown) }
  })
  it('opens the writing panel on top of the page; Cancel closes it and the button comes back', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg }); await tick(100); await connectClave(a, sg); await a.go('#/'); await tick(80)
    fab(a)!.click(); await tick(60)
    const sheet = a.root.querySelector('.sheet')!; expect(sheet.querySelector('textarea')).not.toBeNull(); expect(sheet.querySelector('.composer')).not.toBeNull(); expect(fab(a)).toBeNull()
    expect(document.activeElement).toBe(sheet.querySelector('textarea'))
    await click(a.root, 'Cancel'); expect(a.root.querySelector('.sheet')).toBeNull(); expect(fab(a)).not.toBeNull()
  })
  it('writing, the review step and replying all happen in the panel', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg }); await tick(100); await connectClave(a, sg); await a.go('#/'); await tick(80)
    fab(a)!.click(); await tick(60); const ta = a.root.querySelector('.sheet textarea') as HTMLTextAreaElement; ta.value = 'hello from the button'; ta.dispatchEvent(new Event('input'))
    await click(a.root, 'Review'); expect(a.root.querySelector('.sheet .review')).not.toBeNull(); expect(a.root.querySelector('.sheet .preview')!.textContent).toBe('hello from the button')
    await click(a.root, 'Publish'); await tick(120); expect(a.pub.sent).toHaveLength(1); expect(a.pub.sent[0]!.event.content).toBe('hello from the button'); expect(a.root.querySelector('.sheet')).toBeNull()
    await click(a.root, 'Reply'); expect(a.root.querySelector('.sheet .composer .replying')).not.toBeNull(); expect(fab(a)).toBeNull()
  })
})
