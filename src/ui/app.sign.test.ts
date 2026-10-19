// @vitest-environment happy-dom
import { nip19 } from 'nostr-tools'
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { ev, pk } from '../core/testutil.js'
import { answers, type Fetcher } from '../net/fetcher.js'
import type { Publisher } from '../net/publisher.js'
import type { SignerApi } from '../sign/pipeline.js'
import { parseRoute, startApp } from './app.js'

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
  await a.go('#/me'); await click(a.root, 'Connect a signer'); sg.raw.approve(); await tick(100); await a.go('#/')
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

function boot(o: { events?: Event[]; signer?: ReturnType<typeof fakeSigner>; pub?: ReturnType<typeof publisherFake>; stored?: Record<string, string>; clipboard?: string | Error; copied?: string[]; wide?: boolean; errorMs?: number; verifyWaits?: number[]; zapNet?: Parameters<typeof startApp>[1]['zapNet'] } = {}) {
  const root = document.createElement('div'); document.body.append(root); roots.push(root)
  const location = { hash: '' }, listeners: (() => void)[] = [], mem = new Map(Object.entries(o.stored ?? { me }))
  const pub = o.pub ?? publisherFake()
  startApp(root, {
    fetcher: relays(o.events ?? world), isWide: () => !!o.wide, languages: ['en'], location, onHash: (cb) => listeners.push(cb), setHash: (h) => { location.hash = h; listeners.forEach((l) => l()) }, relays: ['wss://r1.example', 'wss://r2.example'], nowMs: () => 1_700_000_000_000,
    verifyWaitsMs: o.verifyWaits ?? [0], errorMs: o.errorMs, storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) },
    copy: (x) => { o.copied?.push(x) },
    readClipboard: async () => { if (o.clipboard instanceof Error) throw o.clipboard; return o.clipboard ?? '' },
    ...(o.signer ? { signer: o.signer.s, publisher: pub.p } : {}),
    ...(o.zapNet ? { zapNet: o.zapNet } : {}),
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
    await a.go('#/me'); await click(a.root, 'Connect a signer') // opens the panel: the bunker:// address comes first, nothing is started yet
    expect(sg.log).not.toContain('startConnect'); expect(a.text()).toContain('Recommended: paste the bunker address of your signer')
    expect(a.root.querySelector('a.button')).toBeNull()
    await click(a.root, 'Connect a signer') // the alternative, inside "Use a link instead"
    expect(sg.log).toContain('startConnect')
    expect(a.root.querySelector('a.button')!.getAttribute('href')).toMatch(/^https:\/\/clave\.casa\/connect\/\?uri=/)
    // it must open in a NEW tab: leaving this page would throw away the pending connection that Clave is about to answer
    expect(a.root.querySelector('a.button')!.getAttribute('target')).toBe('_blank'); expect(a.root.querySelector('a.button')!.getAttribute('rel')).toBe('noopener noreferrer')
    expect(a.text()).toContain('Waiting for the signer')
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
    expect(a.text()).toContain('Read as…'); await click(a.root, 'Connect a signer'); sg.raw.approve(); await tick(120); await a.go('#/')
    expect(a.mem.get('me')).toBe(me); expect(a.text()).toContain('a post <b>from</b> my friend')
  })
  it('a failed bunker:// connection shows why', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg }); await tick(100)
    await a.go('#/me'); await click(a.root, 'Connect a signer')
    const input = a.root.querySelector('.connect input') as HTMLInputElement; input.value = 'bunker://x'
    a.root.querySelector('.connect form')!.dispatchEvent(new Event('submit', { cancelable: true })); await tick(60)
    expect(a.text()).toMatch(/Could not connect: nope/)
  })
})

describe('pasting the bunker:// address from Clave', () => {
  it('the paste button reads the clipboard and connects with the bunker address', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg, clipboard: 'bunker://' + 'a'.repeat(64) + '?relay=wss%3A%2F%2Frelay.powr.build&secret=s' }); await tick(100)
    await a.go('#/me'); await click(a.root, 'Connect a signer'); await click(a.root, 'Paste and connect')
    expect(sg.log.some((l) => l.startsWith('bunker bunker://'))).toBe(true)
  })
  it('a clipboard that is not a bunker address is refused with a message, and nothing is sent anywhere', async () => {
    for (const clip of ['', 'hello world', 'nostrconnect://abc', 'https://example.com', new Error('permission denied')]) {
      const sg = fakeSigner(); const a = boot({ signer: sg, clipboard: clip }); await tick(100)
      await a.go('#/me'); await click(a.root, 'Connect a signer'); await click(a.root, 'Paste and connect')
      expect(a.text(), String(clip)).toContain('does not hold a bunker:// address'); expect(sg.log.some((l) => l.startsWith('bunker'))).toBe(false)
    }
  })
  it('the typed address still works, and a failure says why', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg }); await tick(100); await a.go('#/me'); await click(a.root, 'Connect a signer')
    const input = a.root.querySelector('.bunker input') as HTMLInputElement; input.value = 'bunker://x'
    a.root.querySelector('.bunker form')!.dispatchEvent(new Event('submit', { cancelable: true })); await tick(60)
    expect(a.text()).toMatch(/Could not connect: nope/)
  })
})

describe('the connect panel survives redraws', () => {
  it('what was typed in the bunker field and the opened "use a link" section are still there after the page redraws', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg }); await tick(100); await a.go('#/me'); await click(a.root, 'Connect a signer')
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
    expect(e.tags).toEqual([['e', post.id], ['p', friend], ['k', '1'], ['client', 'Quill']]) // says it was made with Quill (on unless turned off)
    expect(a.text()).toContain('❤️ → '); expect(a.text()).not.toContain('Published to')
  })
  it('with "Say that I publish from Quill" turned off in Settings, nothing says which app was used', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg }); await tick(100); await connectClave(a, sg)
    await a.go('#/settings'); await tick(50)
    const sw = [...a.root.querySelectorAll('label.check')].find((l) => l.textContent!.includes('Say that I publish from Quill'))!.querySelector('input') as HTMLInputElement
    expect(sw.checked).toBe(true); sw.checked = false; sw.dispatchEvent(new Event('change')); await tick(50)
    await a.go('#/'); await tick(100)
    ;(a.root.querySelector('button[aria-label="React ❤️"]') as HTMLElement).click(); await tick(80)
    expect(a.pub.sent[0]!.event.tags).toEqual([['e', post.id], ['p', friend], ['k', '1']])
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
    expect(a.text()).toMatch(/Waiting for the signer/); expect(a.pub.sent).toEqual([])
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
    const pop = a.root.querySelector('.sign .popup.stay')!; expect(pop.textContent).toMatch(/Waiting for the signer/); expect(pop.querySelector('button')!.textContent).toBe('Cancel')
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
    expect(e.tags).toEqual([['e', post.id, '', 'root'], ['p', friend], ['t', 'nostr'], ['client', 'Quill']])
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
    expect(a.text()).toMatch(/The signer did not answer in time/); expect(a.pub.sent).toEqual([])
    expect(a.root.querySelector('pre.preview')).not.toBeNull()
  })
  it('while waiting for Clave there is a Cancel button: it stops the wait, publishes nothing, keeps the draft', async () => {
    const sg = fakeSigner({ hang: true }); const a = await toReview(sg); await click(a.root, 'Publish')
    expect(a.text()).toMatch(/Waiting for the signer… If it takes long, open it or tap its notification/); expect(sg.log.filter((l) => l.startsWith('sign'))).toHaveLength(1) // ONE request
    await click(a.root, 'Cancel'); await tick(30)
    expect(a.text()).toContain('Cancelled. Nothing was published.'); expect(a.pub.sent).toEqual([]); expect(a.root.querySelector('pre.preview')).not.toBeNull()
  })
  it('a rejection with no reason says so and what to check, instead of a blank', async () => {
    const a = await toReview(fakeSigner({ signError: ' ' })); await click(a.root, 'Publish'); await tick(40)
    expect(a.text()).toContain('The signer did not sign: it gave no reason.'); expect(a.text()).toContain('follow lists'); expect(a.text()).toContain('Nothing was published'); expect(a.pub.sent).toEqual([])
  })
  it('a rejection in Clave publishes nothing', async () => {
    const a = await toReview(fakeSigner({ signError: 'user rejected the request' })); await click(a.root, 'Publish'); await tick(40)
    expect(a.text()).toMatch(/The signer did not sign: user rejected the request. Nothing was published/); expect(a.pub.sent).toEqual([])
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

describe('a reaction one relay turned away', () => {
  it('reached most relays: one quiet line, no panel (some relays only take reactions from their own web of trust); a note would still show the panel', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg, pub: publisherFake({ 'wss://r1.example': 'ok', 'wss://r2.example': 'ok', 'wss://r3.example': 'Policy violated and pubkey is not in our web of trust.' }) })
    await tick(100); await connectClave(a, sg)
    ;(a.root.querySelector('button[aria-label="React 👍"]') as HTMLElement).click(); await tick(80)
    expect(a.text()).not.toContain('Published to 2 of 3 relays'); expect(a.root.querySelector('.popup')!.textContent).toContain('👍 →')
    expect(a.root.querySelector('.result')).toBeNull()
  })
})

describe('signing out', () => {
  it('disconnects the signer too', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg }); await tick(100); await connectClave(a, sg)
    await a.go('#/me'); await click(a.root, 'Sign out'); expect(sg.log).not.toContain('disconnect'); expect(a.root.querySelector('.confirm-signout')).not.toBeNull(); expect(a.mem.has('me')).toBe(true) // one tap only asks
    await click(a.root, 'Cancel'); expect(a.root.querySelector('.confirm-signout')).toBeNull(); expect(a.mem.has('me')).toBe(true)
    await click(a.root, 'Sign out'); ;(a.root.querySelector('.confirm-signout button.danger') as HTMLElement).click(); await tick(40); expect(sg.log).toContain('disconnect'); expect(a.mem.has('me')).toBe(false)
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
    expect(prefs(a).textContent).toContain('Connect a signer (in Me) to publish this list.'); expect([...prefs(a).querySelectorAll('button')].some((b) => b.textContent === 'Publish this list on Nostr')).toBe(false)
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

describe('no empty card when everything floats', () => {
  const area = (a: ReturnType<typeof boot>) => a.root.querySelector('section.sign') as HTMLElement | null
  it('with only the write button, while waiting for Clave, and with the panel open, the area has no card; with something inside it, it does', async () => {
    const sg = fakeSigner({ hang: true }); const a = boot({ signer: sg }); await tick(100); await connectClave(a, sg); await a.go('#/'); await tick(80)
    expect(area(a)!.className).toBe('sign bare') // only the button
    ;(a.root.querySelector('button[aria-label="React ❤️"]') as HTMLElement).click(); await tick(60); expect(area(a)!.className).toBe('sign bare') // only the waiting popup
    ;(a.root.querySelector('.popup.stay button') as HTMLElement).click(); await tick(80)
    a.root.querySelector<HTMLElement>('button.fab')!.click(); await tick(60); expect(area(a)!.className).toBe('sign bare') // only the panel
    await click(a.root, 'Cancel'); await a.go('#/me'); await tick(80); expect(area(a)!.className).toBe('sign') // "signing as …" is inside: a real card
  })
})

describe('the connection status on Me', () => {
  it('on a wide screen Disconnect asks, cancels and disconnects too (the question must survive the redraw, there is no Me page)', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg, wide: true }); await tick(100); await connectClave(a, sg); await tick(250)
    const row = () => a.root.querySelector('.col[data-col="me"] .signing-as')!
    ;(row().lastElementChild as HTMLElement).click(); await tick(60)
    expect(a.root.querySelector('.confirm-disconnect')).not.toBeNull(); expect(sg.log).not.toContain('disconnect') // it asked, and the question stayed
    await click(a.root, 'Cancel'); expect(a.root.querySelector('.confirm-disconnect')).toBeNull(); expect(row()).not.toBeNull()
    ;(row().lastElementChild as HTMLElement).click(); await tick(60)
    ;(a.root.querySelector('.confirm-disconnect button.danger') as HTMLElement).click(); await tick(80)
    expect(sg.log).toContain('disconnect'); expect(a.root.querySelector('.signing-as')).toBeNull()
  })
  it('on a wide screen Sign out asks too, the question survives the redraw, and Cancel leaves everything as it was', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg, wide: true }); await tick(100); await connectClave(a, sg); await tick(250)
    const out = () => [...a.root.querySelectorAll('.col[data-col="me"] button.danger')].find((x) => x.textContent === 'Sign out') as HTMLElement
    out().click(); await tick(60)
    expect(a.root.querySelector('.confirm-signout')).not.toBeNull(); expect(a.mem.get('me')).toBeTruthy(); expect(sg.log).not.toContain('disconnect')
    await click(a.root, 'Cancel'); expect(a.root.querySelector('.confirm-signout')).toBeNull(); expect(a.mem.get('me')).toBeTruthy()
    out().click(); await tick(40); ;(a.root.querySelector('.confirm-signout button.danger') as HTMLElement).click(); await tick(80)
    expect(a.mem.has('me')).toBe(false); expect(sg.log).toContain('disconnect'); expect(a.text()).toContain('Read as…')
  })
  it('on a wide screen the composer offers an emoji picker that puts the emoji where the cursor is and keeps the counter right; a phone does not get it', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg, wide: true }); await tick(100); await connectClave(a, sg); await tick(250)
    ;(a.root.querySelector('button.write') as HTMLElement).click(); await tick(60)
    const ta = a.root.querySelector('.composer textarea') as HTMLTextAreaElement, panel = a.root.querySelector('.emoji-panel') as HTMLElement, toggle = a.root.querySelector('.emoji-toggle') as HTMLElement
    expect(panel.hidden).toBe(true); toggle.click(); expect(panel.hidden).toBe(false); expect(toggle.getAttribute('aria-expanded')).toBe('true')
    ta.value = 'hello world'; ta.dispatchEvent(new Event('input')); ta.selectionStart = ta.selectionEnd = 5
    ;[...panel.querySelectorAll('button')].find((x) => x.textContent === '🔥')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(ta.value).toBe('hello🔥 world'); expect(a.root.querySelector('.composer small')!.textContent).toContain('12') // 11 characters + 1 emoji
    await click(a.root, 'Review'); expect(a.root.querySelector('pre.preview')!.textContent).toContain('hello🔥 world') // what is reviewed and signed is what is on screen
  })
  it('a phone gets no emoji picker (it has its own keyboard), and the composer\'s two buttons are the same kind of button', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg }); await tick(100); await connectClave(a, sg); await a.go('#/'); await tick(80)
    a.root.querySelector<HTMLElement>('button.fab')!.click(); await tick(60)
    expect(a.root.querySelector('.emoji-panel')).toBeNull(); expect(a.root.querySelector('.emoji-toggle')).toBeNull()
    const buttons = [...a.root.querySelectorAll('.composer-buttons button')]; expect(buttons.map((b) => b.textContent)).toEqual(['Review', 'Cancel']); expect(buttons.map((b) => b.className)).toEqual(['', '']) // no "link" on one: that made it smaller
  })
  it('is a status row: a dot, "Clave connected" with who it signs as, and Disconnect on the right as a careful (danger) button', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg }); await tick(100); await connectClave(a, sg); await a.go('#/me'); await tick(80)
    const row = a.root.querySelector('.signing-as')!
    expect([...row.children].map((c) => c.className)).toEqual(['dot', 'who', 'danger']); expect(row.querySelector('strong')!.textContent).toBe('Signer connected'); expect(row.querySelector('.who span')!.textContent).toContain('Signing as')
    expect(row.lastElementChild!.textContent).toBe('Disconnect'); expect(row.querySelector('.dot')!.getAttribute('aria-hidden')).toBe('true')
    // one tap only asks; nothing is disconnected yet
    ;(row.lastElementChild as HTMLElement).click(); await tick(60)
    expect(a.root.querySelector('.confirm-disconnect')!.textContent).toContain('bunker://'); expect(sg.log).not.toContain('disconnect'); expect(a.root.querySelector('.signing-as button')).toBeNull()
    await click(a.root, 'Cancel'); expect(a.root.querySelector('.confirm-disconnect')).toBeNull(); expect(a.root.querySelector('.signing-as button')).not.toBeNull(); expect(sg.log).not.toContain('disconnect')
    ;(a.root.querySelector('.signing-as button') as HTMLElement).click(); await tick(60)
    ;(a.root.querySelector('.confirm-disconnect button.danger') as HTMLElement).click(); await tick(80)
    expect(sg.log).toContain('disconnect'); expect(a.root.querySelector('.signing-as')).toBeNull(); expect(a.root.querySelector('.confirm-disconnect')).toBeNull()
  })
})

describe('a disconnect question left open is forgotten', () => {
  it('leaving Me, or signing out, does not leave it waiting for the next visit', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg }); await tick(100); await connectClave(a, sg); await a.go('#/me'); await tick(80)
    ;(a.root.querySelector('.signing-as button') as HTMLElement).click(); await tick(60); expect(a.root.querySelector('.confirm-disconnect')).not.toBeNull()
    await a.go('#/'); await tick(80); await a.go('#/me'); await tick(80)
    expect(a.root.querySelector('.confirm-disconnect')).toBeNull(); expect(a.root.querySelector('.signing-as button')).not.toBeNull()
  })
})

describe('sharing a note', () => {
  // a note with a REAL signature: the policy refuses to share anything else (the notes of the other tests have fake signatures)
  const sk = generateSecretKey(), author = getPublicKey(sk), signed = finalizeEvent({ kind: 1, created_at: 1_699_999_500, tags: [], content: 'a signed note to share' }, sk)
  const events = (): Event[] => [list(me, 3, [['p', author]]), list(author, 3, []), signed]
  const share = (a: ReturnType<typeof boot>) => a.root.querySelector('button.share') as HTMLButtonElement | null
  const ready = async (o: Parameters<typeof boot>[0] = {}) => { const sg = o.signer ?? fakeSigner(); const a = boot({ events: events(), ...o, signer: sg }); await tick(100); await connectClave(a, sg); await a.go('#/'); await tick(80); return { a, sg } }
  it('there is a Share button on notes the filter shows, only with a signer connected', async () => {
    const out = boot({ events: events(), signer: fakeSigner() }); await tick(100); expect(share(out)).toBeNull()
    const { a } = await ready(); expect(share(a)).not.toBeNull(); expect(share(a)!.getAttribute('aria-label')).toBe('Share'); expect(share(a)!.getAttribute('aria-pressed')).toBe('false'); expect(share(a)!.querySelector('svg')).not.toBeNull()
  })
  it('the "…" of a note offers its id and its link, even without a signer; each copies exactly that and says so', async () => {
    const copied: string[] = []; const a = boot({ events: events(), copied }); await tick(100)
    const menu = a.root.querySelector('.more-menu')!; const id = (a.root.querySelector('article.note') as HTMLElement).dataset.id!
    expect(menu.classList.contains('open')).toBe(false); (menu.querySelector('.more-btn') as HTMLElement).click(); expect(menu.classList.contains('open')).toBe(true)
    await click(a.root, 'Copy note ID'); expect(copied[0]).toMatch(/^nostr:nevent1/); expect(nip19.decode(copied[0]!.slice(6)).data).toMatchObject({ id, relays: ['wss://r1.example', 'wss://r2.example'] }); expect(menu.textContent).toContain('Copied'); await tick(1000); expect(menu.classList.contains('open')).toBe(false); expect(menu.textContent).toContain('Copy note ID')
    ;(menu.querySelector('.more-btn') as HTMLElement).click(); await click(a.root, 'Copy note link'); expect(copied[1]).toMatch(/^https:\/\/quill\.hivescope\.xyz\/#\/note\/nevent1/); expect((nip19.decode(copied[1]!.split('/').pop()!).data as { id: string }).id).toBe(id); expect(parseRoute(copied[1]!.slice(copied[1]!.indexOf('#')))).toEqual({ name: 'note', id }) // the link opens that very note in Quill
  })
  it('the menu closes on a tap anywhere else and on Escape', async () => {
    const a = boot({ events: events(), copied: [] }); await tick(100)
    const menu = () => a.root.querySelector('.more-menu')!; const btn = () => menu().querySelector('.more-btn') as HTMLElement
    btn().click(); await tick(10); document.body.click(); expect(menu().classList.contains('open')).toBe(false)
    btn().click(); await tick(10); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); expect(menu().classList.contains('open')).toBe(false)
  })
  it('a tap only asks: the note is shown with a warning that it is public, and nothing is signed until the second tap; Cancel closes it', async () => {
    const { a, sg } = await ready(); share(a)!.click(); await tick(60)
    const box = a.root.querySelector('.sheet .review')!; expect(box.querySelector('h2')!.textContent).toBe('Share this note?'); expect(box.querySelector('.preview')!.textContent).toContain('a signed note to share'); expect(box.textContent).toContain('This is public')
    expect(a.pub.sent).toEqual([]); expect(sg.log.filter((l) => l.startsWith('sign'))).toHaveLength(0)
    await click(a.root, 'Cancel'); expect(a.root.querySelector('.sheet')).toBeNull(); expect(a.pub.sent).toEqual([])
  })
  it('confirming signs and publishes a kind 6 repost with exactly the pointer and a faithful copy, marks the button, and says so', async () => {
    const { a } = await ready(); share(a)!.click(); await tick(60); await click(a.root, 'Share'); await tick(150)
    expect(a.pub.sent).toHaveLength(1); const e = a.pub.sent[0]!.event
    expect(e.kind).toBe(6); expect(e.tags).toEqual([['e', signed.id, 'wss://r1.example'], ['p', author]]); expect(JSON.parse(e.content)).toEqual({ id: signed.id, pubkey: signed.pubkey, created_at: signed.created_at, kind: 1, tags: [], content: 'a signed note to share', sig: signed.sig }) // a faithful copy of the note, nothing more
    expect(share(a)!.getAttribute('aria-pressed')).toBe('true'); expect(share(a)!.getAttribute('aria-label')).toBe('You shared this note'); expect(a.text()).toContain('Shared: note by'); expect(a.root.querySelector('.sheet')).toBeNull()
  })
  it('sharing again does not sign a second time', async () => {
    const { a, sg } = await ready(); share(a)!.click(); await tick(60); await click(a.root, 'Share'); await tick(150)
    share(a)!.click(); await tick(100); expect(a.root.querySelector('.sheet')).toBeNull(); expect(a.text()).toContain('You already shared this note.'); expect(a.pub.sent).toHaveLength(1); expect(sg.log.filter((l) => l.startsWith('sign'))).toHaveLength(1)
  })
  it('what was shared in an earlier visit (or from another app) is already marked when the page opens', async () => {
    const sg = fakeSigner(); const shared = ev(me, JSON.stringify(signed), { kind: 6, created_at: 1_700_000_100, tags: [['e', signed.id], ['p', author]] })
    const a = boot({ signer: sg, events: [...events(), shared] }); await tick(120); await connectClave(a, sg); await a.go('#/'); await tick(120)
    expect(share(a)!.getAttribute('aria-pressed')).toBe('true')
  })
  it('a note the filter hides cannot be shared from here (it would amplify what Quill folded): its card has no Share button, a visible one does', async () => {
    const mutedSk = generateSecretKey(), mutedPk = getPublicKey(mutedSk), hiddenNote = finalizeEvent({ kind: 1, created_at: 1_699_999_700, tags: [], content: 'a note from somebody muted' }, mutedSk)
    const sg = fakeSigner(); const a = boot({ signer: sg, events: [list(me, 3, [['p', author], ['p', mutedPk]]), ev(me, '', { kind: 10000, created_at: 5, tags: [['p', mutedPk]] }), list(author, 3, []), list(mutedPk, 3, []), signed, hiddenNote] })
    await tick(100); await connectClave(a, sg); await a.go('#/'); await tick(120)
    const hidden = a.root.querySelector('details.folded')!; expect(hidden.textContent).toContain('a note from somebody muted'); expect(hidden.querySelector('button.share')).toBeNull(); expect(a.root.querySelectorAll('button.share').length).toBe(1)
  })
  it('a failed signature does not mark anything and publishes nothing', async () => {
    const sg = fakeSigner({ signError: 'user rejected the request' }); const { a } = await ready({ signer: sg })
    share(a)!.click(); await tick(60); await click(a.root, 'Share'); await tick(150); expect(a.pub.sent).toEqual([]); expect(share(a)!.getAttribute('aria-pressed')).toBe('false')
  })
  it('a note with a fake signature is refused by the policy, not signed: the signer is never asked', async () => {
    const fake = ev(author, 'a note with a forged signature', { created_at: 1_699_999_600 }); const sg = fakeSigner()
    const a = boot({ signer: sg, events: [list(me, 3, [['p', author]]), list(author, 3, []), fake] }); await tick(100); await connectClave(a, sg); await a.go('#/'); await tick(80)
    share(a)!.click(); await tick(60); await click(a.root, 'Share'); await tick(150); expect(a.pub.sent).toEqual([]); expect(sg.log.filter((l) => l.startsWith('sign'))).toHaveLength(0); expect(a.text()).toContain('That repost is not valid.')
  })
  it('a question left open is forgotten when the signer disconnects', async () => {
    const { a } = await ready(); share(a)!.click(); await tick(60); expect(a.root.querySelector('.sheet .review')).not.toBeNull()
    await a.go('#/me'); await tick(80); ;(a.root.querySelector('.signing-as button') as HTMLElement).click(); await tick(60); ;(a.root.querySelector('.confirm-disconnect button.danger') as HTMLElement).click(); await tick(100)
    expect(a.root.querySelector('.sheet')).toBeNull()
  })
})

describe('quoting a note', () => {
  const sk = generateSecretKey(), author = getPublicKey(sk), signed = finalizeEvent({ kind: 1, created_at: 1_699_999_500, tags: [], content: 'a signed note to quote' }, sk)
  const events = (): Event[] => [list(me, 3, [['p', author]]), list(author, 3, []), ev(author, JSON.stringify({ name: 'Quinn' }), { kind: 0, created_at: 5 }), signed]
  const share = (a: ReturnType<typeof boot>) => a.root.querySelector('button.share') as HTMLButtonElement
  const open = async () => { const sg = fakeSigner(); const a = boot({ events: events(), signer: sg }); await tick(100); await connectClave(a, sg); await a.go('#/'); await tick(80); share(a).click(); await tick(60); return { a, sg } }
  const write = (a: ReturnType<typeof boot>, text: string) => { const ta = a.root.querySelector('.sheet textarea') as HTMLTextAreaElement; ta.value = text; ta.dispatchEvent(new Event('input')) }
  it('the share panel offers Quote next to Share; it opens the writing panel with the note being quoted, a placeholder for the comment, and a counter that leaves room for the reference', async () => {
    const { a } = await open(); expect([...a.root.querySelectorAll('.sheet button')].map((b) => b.textContent)).toEqual(['Share', 'Quote with a comment', 'Cancel'])
    await click(a.root, 'Quote with a comment')
    const sheet = a.root.querySelector('.sheet')!; expect(sheet.querySelector('.review')).toBeNull(); expect(sheet.querySelector('.replying')!.textContent).toContain('Quoting Quinn'); expect(sheet.querySelector('.replying q')!.textContent).toContain('a signed note to quote')
    expect(sheet.querySelector('textarea')!.getAttribute('placeholder')).toBe('Your comment…'); const m = /0 \/ (\d+)/.exec(sheet.querySelector('small')!.textContent!)!; expect(Number(m[1])).toBeLessThan(1000); expect(Number(m[1])).toBeGreaterThan(800)
  })
  it('a quote without a comment is refused with a message (it would just be a share)', async () => {
    const { a } = await open(); await click(a.root, 'Quote with a comment'); await click(a.root, 'Review'); expect(a.text()).toContain('Write your comment'); expect(a.root.querySelector('.review')).toBeNull()
    write(a, '   '); await click(a.root, 'Review'); expect(a.root.querySelector('.review')).toBeNull()
  })
  it('review shows the exact note: the comment, the reference, the q and p tags and no e tag; publishing signs exactly that and does NOT mark the note as answered', async () => {
    const { a, sg } = await open(); await click(a.root, 'Quote with a comment'); write(a, 'worth reading #nostr'); await click(a.root, 'Review')
    const rev = a.root.querySelector('.sheet .review')!; expect(rev.querySelector('.preview')!.textContent).toMatch(/^worth reading #nostr\n\nnostr:nevent1/); expect(rev.textContent).toContain('Quoting a note by Quinn')
    await click(a.root, 'Publish'); await tick(150)
    expect(a.pub.sent).toHaveLength(1); const e = a.pub.sent[0]!.event
    expect(e.kind).toBe(1); expect(e.content).toMatch(/^worth reading #nostr\n\nnostr:nevent1/); expect(e.tags.filter((t) => t[0] === 'q')).toEqual([['q', signed.id, 'wss://r1.example', author]]); expect(e.tags.some((t) => t[0] === 'e')).toBe(false)
    expect(e.tags).toContainEqual(['p', author]); expect(e.tags).toContainEqual(['t', 'nostr']); expect(sg.log.filter((l) => l.startsWith('sign'))).toHaveLength(1)
    expect(a.root.querySelector('button.link.on')).toBeNull() // "Replied" is not lit: a quote is not a reply
  })
  it('the comment cannot use up the room of the reference: too long a comment is refused by the usual limit', async () => {
    const { a } = await open(); await click(a.root, 'Quote with a comment'); write(a, 'x'.repeat(990)); await click(a.root, 'Review'); expect(a.root.querySelector('.review')).toBeNull(); expect(a.text()).toContain('limit 1000 characters')
  })
  it('Cancel leaves the writing panel and nothing is signed', async () => {
    const { a, sg } = await open(); await click(a.root, 'Quote with a comment'); await click(a.root, 'Cancel'); expect(a.root.querySelector('.sheet')).toBeNull(); expect(a.pub.sent).toEqual([]); expect(sg.log.filter((l) => l.startsWith('sign'))).toHaveLength(0)
  })
})

describe('following and unfollowing', () => {
  const key = (n: number) => ('a' + n.toString(16).padStart(3, '0')).repeat(16)
  const target = key(9), baseTags = (): string[][] => [['p', friend], ['p', key(1), 'wss://hint.example'], ['t', 'nostr']]
  const myList = (tags = baseTags(), at = 1000) => ev(me, '{"old":"relays"}', { kind: 3, created_at: at, tags })
  const prof = ev(target, JSON.stringify({ name: 'Quinn' }), { kind: 0, created_at: 5 })
  /** A relay world that LEARNS what Quill publishes, like a real relay (so the check after publishing can see it). */
  const world2 = (events: Event[]) => { const pub = publisherFake(); const real = pub.p.publish; pub.p.publish = async (e, o) => { if (e.kind === 3) { const i = events.findIndex((x) => x.kind === 3 && x.pubkey === e.pubkey); if (i >= 0) events.splice(i, 1); events.push(e) } return real(e, o) }; return pub }
  const button = (a: ReturnType<typeof boot>, label: string) => [...a.root.querySelectorAll('.profile button')].find((b) => b.textContent === label) as HTMLButtonElement | undefined
  const open = async (o: { events?: Event[]; stored?: Record<string, string>; signer?: ReturnType<typeof fakeSigner>; pub?: ReturnType<typeof publisherFake>; at?: string } = {}) => {
    const events = o.events ?? [myList(), list(friend, 3, []), prof]; const sg = o.signer ?? fakeSigner(); const pub = o.pub ?? world2(events)
    const a = boot({ events, signer: sg, pub, stored: o.stored }); await tick(100); await connectClave(a, sg); await a.go(o.at ?? `#/user/${target}`); await tick(250); return { a, sg, events, pub }
  }
  const signs = (sg: ReturnType<typeof fakeSigner>) => sg.log.filter((l) => l.startsWith('sign')).length

  it('the button is there only with a signer connected, says Follow or Unfollow by what you do now, and never on your own page', async () => {
    const out = boot({ events: [myList(), list(friend, 3, []), prof], signer: fakeSigner() }); await tick(100); await out.go(`#/user/${target}`); await tick(250); expect(button(out, 'Follow')).toBeUndefined()
    const { a } = await open(); expect(button(a, 'Follow')).toBeDefined(); expect(button(a, 'Unfollow')).toBeUndefined()
    await a.go(`#/user/${friend}`); await tick(250); expect(button(a, 'Unfollow')).toBeDefined(); await a.go(`#/user/${me}`); await tick(250); expect(button(a, 'Follow') ?? button(a, 'Unfollow')).toBeUndefined()
  })
  it('a tap reads the list and asks: exactly what changes (from N to N+1 accounts), that it is public, and nothing is signed yet; Cancel closes it', async () => {
    const { a, sg } = await open(); button(a, 'Follow')!.click(); await tick(200)
    const box = a.root.querySelector('.sheet .review')!; expect(box.querySelector('h2')!.textContent).toBe('Follow Quinn?'); expect(box.textContent).toContain('goes from 2 to 3 accounts'); expect(box.textContent).toContain('public')
    expect(a.pub.sent).toEqual([]); expect(signs(sg)).toBe(0); await click(a.root, 'Cancel'); expect(a.root.querySelector('.sheet')).toBeNull(); expect(a.pub.sent).toEqual([])
  })
  it('confirming signs the list as it is on the relays with ONE account added at the end, keeps a backup of the old one, remembers the new list, checks the relays and says so', async () => {
    const { a, sg } = await open(); button(a, 'Follow')!.click(); await tick(200); const base = myList(); await click(a.root.querySelector('.sheet')! as HTMLElement, 'Follow'); await tick(400)
    expect(a.pub.sent).toHaveLength(1); const e = a.pub.sent[0]!.event
    expect(e.kind).toBe(3); expect(e.tags).toEqual([...baseTags(), ['p', target]]); expect(e.content).toBe('{"old":"relays"}'); expect(e.created_at).toBeGreaterThan(base.created_at); expect(signs(sg)).toBe(1)
    const backup = JSON.parse(a.mem.get(`followbackup:${me}`)!) as Event[]; expect(backup).toHaveLength(1); expect(backup[0]!.tags).toEqual(baseTags())
    expect(JSON.parse(a.mem.get(`following:${me}`)!).sort()).toEqual([friend, key(1), target].sort()); expect(a.text()).toContain('Now following Quinn'); expect(button(a, 'Unfollow')).toBeDefined()
  })
  it('unfollowing removes only that account and keeps everything else of the list, hints included', async () => {
    const { a } = await open({ events: [myList([...baseTags(), ['p', target, 'wss://x.example', 'Quinn']]), list(friend, 3, []), prof] }); await a.go(`#/user/${target}`); await tick(250)
    button(a, 'Unfollow')!.click(); await tick(200); expect(a.root.querySelector('.sheet h2')!.textContent).toBe('Stop following Quinn?'); expect(a.root.querySelector('.sheet')!.textContent).toContain('goes from 3 to 2 accounts')
    await click(a.root.querySelector('.sheet')! as HTMLElement, 'Unfollow'); await tick(400); expect(a.pub.sent[0]!.event.tags).toEqual(baseTags()); expect(a.text()).toContain('No longer following Quinn')
  })
  it('if the list changed while you were deciding, you see the new numbers and confirm again; the signature uses the NEW list, never the old one', async () => {
    const { a, events } = await open(); button(a, 'Follow')!.click(); await tick(200)
    events.splice(events.findIndex((x) => x.kind === 3 && x.pubkey === me), 1, myList([...baseTags(), ['p', key(5)]], 2000)) // another app followed somebody
    await click(a.root.querySelector('.sheet')! as HTMLElement, 'Follow'); await tick(200)
    expect(a.root.querySelector('.sheet .error')!.textContent).toContain('changed while you were deciding'); expect(a.root.querySelector('.sheet')!.textContent).toContain('goes from 3 to 4 accounts'); expect(a.pub.sent).toEqual([])
    await click(a.root.querySelector('.sheet')! as HTMLElement, 'Follow'); await tick(400); expect(a.pub.sent[0]!.event.tags).toEqual([...baseTags(), ['p', key(5)], ['p', target]])
  })
  it('a list that turns out to be much shorter when read again right before signing is refused, and nothing is signed', async () => {
    const tenFollows = (): string[][] => Array.from({ length: 10 }, (_, i) => ['p', key(200 + i)])
    const { a, sg, events } = await open({ events: [myList(tenFollows()), list(friend, 3, []), prof] }); button(a, 'Follow')!.click(); await tick(200)
    expect(a.root.querySelector('.sheet')!.textContent).toContain('goes from 10 to 11 accounts')
    events.splice(events.findIndex((x) => x.kind === 3 && x.pubkey === me), 1, myList(tenFollows().slice(0, 2), 2000)) // a relay now answers with a stale, shorter list
    await click(a.root.querySelector('.sheet')! as HTMLElement, 'Follow'); await tick(250)
    expect(a.root.querySelector('.sheet h2')!.textContent).toBe('Quill will not change your follow list'); expect(a.pub.sent).toEqual([]); expect(signs(sg)).toBe(0)
  })
  it('no list of yours found: Quill refuses (it could erase the real one) and signs nothing', async () => {
    const { a, sg } = await open({ events: [list(friend, 3, []), prof] }); button(a, 'Follow')!.click(); await tick(250)
    expect(a.root.querySelector('.sheet h2')!.textContent).toBe('Quill will not change your follow list'); expect(a.root.querySelector('.sheet')!.textContent).toContain('No follow list of yours was found'); expect(a.root.querySelector('.sheet')!.textContent).not.toContain('Accept the current list')
    expect(a.pub.sent).toEqual([]); expect(signs(sg)).toBe(0)
  })
  it('a list much shorter than the one Quill saw is refused; accepting the current list makes it the reference and goes on', async () => {
    const seen = JSON.stringify(Array.from({ length: 100 }, (_, i) => key(100 + i)))
    const { a, sg } = await open({ stored: { me, [`following:${me}`]: seen } }); button(a, 'Follow')!.click(); await tick(250)
    const sheet = () => a.root.querySelector('.sheet')!; expect(sheet().textContent).toContain('has 2 accounts, but Quill had seen 100'); expect(a.pub.sent).toEqual([]); expect(signs(sg)).toBe(0)
    await click(a.root, 'Accept the current list'); await tick(300); expect(sheet().querySelector('h2')!.textContent).toBe('Follow Quinn?'); expect(sheet().textContent).toContain('goes from 2 to 3 accounts')
  })
  it('a failed signature changes nothing: the list the reader is remembered to have, and the button, stay as they were', async () => {
    const sg = fakeSigner({ signError: 'user rejected the request' }); const { a } = await open({ signer: sg }); const before = a.mem.get(`following:${me}`)
    button(a, 'Follow')!.click(); await tick(200); await click(a.root.querySelector('.sheet')! as HTMLElement, 'Follow'); await tick(400)
    expect(a.pub.sent).toEqual([]); expect(a.mem.get(`following:${me}`)).toBe(before); expect(button(a, 'Follow')).toBeDefined()
  })
  it('if the relays do not show the new list afterwards it says so instead of claiming success', async () => {
    const events = [myList(), list(friend, 3, []), prof]; const pub = publisherFake() // a relay that never learns it
    const { a } = await open({ events, pub }); button(a, 'Follow')!.click(); await tick(200); await click(a.root.querySelector('.sheet')! as HTMLElement, 'Follow'); await tick(400)
    expect(a.pub.sent).toHaveLength(1); expect(a.text()).toContain('your relays do not show it yet')
  })
  it('a panel left open is forgotten when the signer disconnects', async () => {
    const { a } = await open(); button(a, 'Follow')!.click(); await tick(200); expect(a.root.querySelector('.sheet .review')).not.toBeNull()
    await a.go('#/me'); await tick(80); ;(a.root.querySelector('.signing-as button') as HTMLElement).click(); await tick(60); ;(a.root.querySelector('.confirm-disconnect button.danger') as HTMLElement).click(); await tick(100); expect(a.root.querySelector('.sheet')).toBeNull()
  })
})

describe('messages do not stay fixed at the bottom', () => {
  const sgn = generateSecretKey(), author = getPublicKey(sgn), signed = finalizeEvent({ kind: 1, created_at: 1_699_999_500, tags: [], content: 'a signed note' }, sgn)
  const fail = async (errorMs?: number) => {
    const sg = fakeSigner({ signError: 'user rejected the request' }); const a = boot({ signer: sg, errorMs, events: [list(me, 3, [['p', author]]), list(author, 3, []), signed] })
    await tick(100); await connectClave(a, sg); await a.go('#/'); await tick(80); (a.root.querySelector('button[aria-label="React ❤️"]') as HTMLElement).click(); await tick(150); return a
  }
  it('an error stays long enough to read, then goes away by itself', async () => {
    const a = await fail(300); expect(a.root.querySelector('.toast .error')).not.toBeNull(); await tick(400); expect(a.root.querySelector('.toast .error')).toBeNull()
  })
  it('an error can be closed with its button, at once', async () => {
    const a = await fail(); const bar = a.root.querySelector('.toast .error')!; expect(bar.querySelector('button')!.textContent).toBe('Close')
    ;(bar.querySelector('button') as HTMLElement).click(); await tick(60); expect(a.root.querySelector('.toast .error')).toBeNull()
  })
  it('a newer message is not cleared by the timer of an older one', async () => {
    const a = await fail(400); await tick(200); (a.root.querySelector('button[aria-label="React 🙏"]') as HTMLElement).click(); await tick(150) // a second failure, ~350 ms after the first
    expect(a.root.querySelector('.toast .error')).not.toBeNull() // the first message's timer (400 ms) has passed by now (~500 ms); the second one is still showing
  })
})

describe('after following, the relays get time to show the new list', () => {
  const key = (n: number) => ('b' + n.toString(16).padStart(3, '0')).repeat(16), target = key(9)
  it('a relay that shows the list a moment late is NOT reported as missing it', async () => {
    const events: Event[] = [ev(me, '', { kind: 3, created_at: 1000, tags: [['p', friend]] }), list(friend, 3, []), ev(target, JSON.stringify({ name: 'Quinn' }), { kind: 0, created_at: 5 })]
    const pub = publisherFake(); const real = pub.p.publish; pub.p.publish = async (e, o) => { setTimeout(() => events.push(e), 120); return real(e, o) } // the relay learns it 120 ms later
    const sg = fakeSigner(); const a = boot({ events, signer: sg, pub, verifyWaits: [0, 250] }); await tick(100); await connectClave(a, sg); await a.go(`#/user/${target}`); await tick(250)
    ;([...a.root.querySelectorAll('.profile button')].find((b) => b.textContent === 'Follow') as HTMLElement).click(); await tick(200); await click(a.root.querySelector('.sheet')! as HTMLElement, 'Follow'); await tick(700)
    expect(a.text()).toContain('Now following Quinn'); expect(a.text()).not.toContain('do not show it yet')
  })
})

describe('muting and unmuting (the mute list, kind 10000, with the same care as the follow list)', () => {
  const target = ('b' + '123').repeat(16), other = ('c' + '456').repeat(16)
  const prof = ev(target, JSON.stringify({ name: 'Quinn' }), { kind: 0, created_at: 5 })
  const muteList = (tags: string[][], content = 'ENCRYPTED-PRIVATE-PART', at = 1000) => ev(me, content, { kind: 10000, created_at: at, tags })
  const learn = (events: Event[]) => { const pub = publisherFake(); const real = pub.p.publish; pub.p.publish = async (e, o) => { if (e.kind === 10000) { const i = events.findIndex((x) => x.kind === 10000 && x.pubkey === e.pubkey); if (i >= 0) events.splice(i, 1); events.push(e) } return real(e, o) }; return pub }
  const open = async (events: Event[], at = `#/user/${target}`) => {
    const sg = fakeSigner(); const a = boot({ events, signer: sg, pub: learn(events) }); await tick(100); await connectClave(a, sg); await a.go(at); await tick(250); return { a, sg, events }
  }
  const button = (a: ReturnType<typeof boot>, label: string) => [...a.root.querySelectorAll('.profile button')].find((b) => b.textContent === label) as HTMLButtonElement | undefined
  const base = () => [list(me, 3, [['p', friend]]), list(friend, 3, []), prof]

  it('muting from the account page keeps the whole list (other accounts, muted words, the private part) and adds ONE account; it says the list is public', async () => {
    const { a } = await open([...base(), muteList([['p', other], ['word', 'giveaway']])])
    button(a, 'Mute')!.click(); await tick(200)
    const box = a.root.querySelector('.sheet .review')!; expect(box.querySelector('h2')!.textContent).toBe('Mute Quinn?'); expect(box.textContent).toContain('goes from 1 to 2 accounts'); expect(box.textContent).toContain('anyone can see whom you muted')
    expect(a.pub.sent).toEqual([])
    await click(a.root.querySelector('.sheet')! as HTMLElement, 'Mute'); await tick(500)
    const e = a.pub.sent[0]!.event; expect(e.kind).toBe(10000); expect(e.tags).toEqual([['p', other], ['word', 'giveaway'], ['p', target]]); expect(e.content).toBe('ENCRYPTED-PRIVATE-PART')
    expect(a.text()).toContain('Muted Quinn'); expect(button(a, 'Unmute')).toBeDefined()
  })
  it('unmuting removes only that account', async () => {
    const { a } = await open([...base(), muteList([['p', other], ['p', target]])])
    button(a, 'Unmute')!.click(); await tick(200); expect(a.root.querySelector('.sheet h2')!.textContent).toBe('Unmute Quinn?')
    await click(a.root.querySelector('.sheet')! as HTMLElement, 'Unmute'); await tick(500); expect(a.pub.sent[0]!.event.tags).toEqual([['p', other]]); expect(a.text()).toContain('Quinn is no longer muted')
  })
  it('with no mute list at all, the first one holds just that account and nothing private', async () => {
    const { a } = await open(base())
    button(a, 'Mute')!.click(); await tick(200); expect(a.root.querySelector('.sheet')!.textContent).toContain('goes from 0 to 1 accounts')
    await click(a.root.querySelector('.sheet')! as HTMLElement, 'Mute'); await tick(500)
    const e = a.pub.sent[0]!.event; expect(e.kind).toBe(10000); expect(e.tags).toEqual([['p', target]]); expect(e.content).toBe('')
  })
  it('refuses when the list was seen at login but is not found now (a new one could erase the real one)', async () => {
    const events = [...base(), muteList([['p', other]])]
    const { a } = await open(events)
    events.splice(events.findIndex((x) => x.kind === 10000), 1) // the relays do not give it back now
    button(a, 'Mute')!.click(); await tick(250)
    expect(a.root.querySelector('.sheet h2')!.textContent).toBe('Quill will not change your mute list'); expect(a.pub.sent).toEqual([])
  })
  it('the "…" of a note offers to mute its author, and the same confirmation follows', async () => {
    const { a } = await open([...base(), muteList([['p', other]]), ev(target, 'a note by Quinn', { created_at: 9000 }), list(friend, 3, [['p', target]])], `#/user/${target}`)
    const note = [...a.root.querySelectorAll('article.note')].find((n) => n.textContent!.includes('a note by Quinn'))!
    ;(note.querySelector('.more-btn') as HTMLButtonElement).click(); await tick(20)
    const item = [...note.querySelectorAll('.more-list button')].find((b) => b.textContent === 'Mute Quinn') as HTMLButtonElement; expect(item).toBeDefined()
    item.click(); await tick(250); expect(a.root.querySelector('.sheet h2')!.textContent).toBe('Mute Quinn?')
  })
})

describe('editing your description in Me', () => {
  const myProfile = (about: string, at = 1000, extra: Record<string, unknown> = {}) => ev(me, JSON.stringify({ name: 'Me', picture: 'https://p.example/me.png', lud16: 'me@wallet.example', about, ...extra }), { kind: 0, created_at: at, tags: [['alt', 'profile']] })
  const learn = (events: Event[]) => { const pub = publisherFake(); const real = pub.p.publish; pub.p.publish = async (e, o) => { if (e.kind === 0) { const i = events.findIndex((x) => x.kind === 0 && x.pubkey === e.pubkey); if (i >= 0) events.splice(i, 1); events.push(e) } return real(e, o) }; return pub }
  const open = async (events: Event[]) => { const sg = fakeSigner(); const a = boot({ events, signer: sg, pub: learn(events) }); await tick(100); await connectClave(a, sg); await a.go('#/me'); await tick(300); return { a, events } }
  const btn = (a: ReturnType<typeof boot>, label: string) => [...a.root.querySelectorAll('.account button')].find((b) => b.textContent === label) as HTMLButtonElement | undefined
  const typeIn = (a: ReturnType<typeof boot>, text: string) => { const t = a.root.querySelector('textarea.about-edit') as HTMLTextAreaElement; t.value = text; t.dispatchEvent(new Event('input')) }

  it('shows it under your name; saving publishes your newest profile with only the description changed, and checks the relays', async () => {
    const { a } = await open([...world, myProfile('old about')])
    expect(a.root.querySelector('.account .about')!.textContent).toBe('old about')
    btn(a, 'Edit description')!.click(); await tick(30); expect(a.root.querySelector('.account')!.textContent).toContain('Quill changes only the description')
    typeIn(a, 'new about'); btn(a, 'Save')!.click(); await tick(600)
    const e = a.pub.sent[0]!.event; expect(e.kind).toBe(0); expect(e.tags).toEqual([['alt', 'profile']])
    expect(JSON.parse(e.content)).toEqual({ name: 'Me', picture: 'https://p.example/me.png', lud16: 'me@wallet.example', about: 'new about' })
    expect(a.text()).toContain('Description saved'); expect(a.root.querySelector('.account .about')!.textContent).toBe('new about')
  })
  it('refuses when your profile is not found right then (a profile from nothing would erase the real one)', async () => {
    const events = [...world, myProfile('old about')]; const { a } = await open(events)
    btn(a, 'Edit description')!.click(); await tick(30)
    events.splice(events.findIndex((x) => x.kind === 0 && x.pubkey === me), 1)
    typeIn(a, 'new'); btn(a, 'Save')!.click(); await tick(300)
    expect(a.pub.sent).toEqual([]); expect(a.text()).toContain('Your profile was not found')
  })
  it('if the profile changed elsewhere meanwhile, nothing is signed until you save again; then the NEW profile is kept', async () => {
    const events = [...world, myProfile('old about')]; const { a } = await open(events)
    btn(a, 'Edit description')!.click(); await tick(30); typeIn(a, 'mine')
    events.splice(events.findIndex((x) => x.kind === 0 && x.pubkey === me), 1, myProfile('old about', 2000, { picture: 'https://p.example/new.png' }))
    btn(a, 'Save')!.click(); await tick(300); expect(a.pub.sent).toEqual([]); expect(a.text()).toContain('changed elsewhere')
    btn(a, 'Save')!.click(); await tick(600)
    expect(JSON.parse(a.pub.sent[0]!.event.content)).toMatchObject({ picture: 'https://p.example/new.png', about: 'mine' })
  })
  it('without a signer there is no Edit button', async () => {
    const a = boot({ events: [...world, myProfile('hello')], stored: { me } }); await tick(100); await a.go('#/me'); await tick(300)
    expect(a.root.querySelector('.account .about')!.textContent).toBe('hello'); expect(btn(a, 'Edit description')).toBeUndefined()
  })
})

describe('starting with the signer already connected', () => {
  it('the app comes up (a draw during start must not reach state declared further down) and Me shows the description with its Edit button', async () => {
    // like the real Signer: a saved session resumes at once and tells the app right then, while the app is still starting (its first draw comes before
    // the state declared further down in startApp is set up: that broke twice)
    const sg = fakeSigner({ saved: true }); const raw = sg.raw as unknown as { resume: () => Promise<boolean>; approve: () => void }; raw.resume = async () => true
    const resume = (sg.raw as unknown as { resume: () => Promise<boolean> }); resume.resume = () => { raw.approve(); return Promise.resolve(true) }
    const a = boot({ events: [...world, ev(me, JSON.stringify({ name: 'Me', about: 'hello there' }), { kind: 0, created_at: 5 })], signer: sg, stored: { me } }); await tick(200)
    expect(a.root.querySelector('article.note, .empty, .feedmode')).not.toBeNull() // the feed came up
    await a.go('#/me'); await tick(400)
    expect(a.root.querySelector('.account .about')!.textContent).toBe('hello there')
    expect([...a.root.querySelectorAll('.account button')].some((b) => b.textContent === 'Edit description')).toBe(true)
    await a.go('#/mentions'); await tick(300); await a.go('#/search'); await tick(100); expect(a.root.querySelector('input.search-box')).not.toBeNull()
  })
})

describe('a locked HiveScope Bunker', () => {
  it('is said at start, once, before any signature fails; a signature refused as locked says how to unlock it', async () => {
    const sg = fakeSigner({ saved: true, signError: 'the bunker is locked' }); const raw = sg.raw as unknown as { resume: () => Promise<boolean>; approve: () => void; locked: () => Promise<boolean> }
    raw.resume = () => { raw.approve(); return Promise.resolve(true) }
    raw.locked = async () => true
    const a = boot({ events: world, signer: sg, stored: { me } }); await tick(300)
    expect(a.text()).toContain('HiveScope Bunker) is locked'); expect(a.text()).toContain('hivescope-bunker unlock')
    expect(sg.log.filter((x) => x.startsWith('sign'))).toEqual([]) // known without trying to sign
    ;(a.root.querySelector('p.error button') as HTMLElement).click(); await tick(20)
    ;([...a.root.querySelectorAll('.actions button.react')].find((b) => b.textContent === '👍') as HTMLElement).click(); await tick(300)
    expect(a.text()).toContain('Nothing was published'); expect(a.text()).toContain('hivescope-bunker unlock')
  })
})

describe('deleting your own note', () => {
  const open = async (events: Event[]) => { const sg = fakeSigner(); const a = boot({ events, signer: sg }); await tick(100); await connectClave(a, sg); await a.go('#/me'); await tick(400); return { a, sg } }
  const menu = (n: Element) => { (n.querySelector('.more-btn') as HTMLButtonElement).click(); return [...n.querySelectorAll('.more-list button')].map((b) => b.textContent) }
  it('your notes offer Delete (others offer Mute, not Delete); it asks first, shows the note and what deleting does, then asks the relays and the note is shown as deleted', async () => {
    const mine = ev(me, 'a note with a typo', { created_at: 9000 })
    const { a } = await open([...world, mine, ev(friend, 'friend note', { created_at: 8000 })])
    const card = [...a.root.querySelectorAll('article.note')].find((n) => n.textContent!.includes('a note with a typo'))!
    const items = menu(card); expect(items).toContain('Delete note'); expect(items.some((x) => x!.startsWith('Mute'))).toBe(false)
    ;([...card.querySelectorAll('.more-list button')].find((b) => b.textContent === 'Delete note') as HTMLButtonElement).click(); await tick(30)
    const sheet = a.root.querySelector('.sheet')!; expect(sheet.querySelector('h2')!.textContent).toBe('Delete this note?'); expect(sheet.textContent).toContain('a note with a typo'); expect(sheet.textContent).toContain('not an eraser')
    expect(a.pub.sent).toEqual([])
    expect(a.root.ownerDocument.activeElement).toBe(sheet.querySelector('[role="alertdialog"]')) // the question has the focus (not its Delete button: Enter must not delete)
    await click(sheet as HTMLElement, 'Delete'); await tick(500)
    const e = a.pub.sent[0]!.event; expect(e.kind).toBe(5); expect(e.tags).toEqual([['e', mine.id], ['k', '1']])
    expect(a.text()).toContain('You deleted this note.'); expect(a.text()).not.toContain('a note with a typo')
    expect(JSON.parse(a.mem.get(`deleted:${me}`)!)).toEqual([mine.id])
  })
  it('another account\'s note offers Mute, not Delete', async () => {
    const { a } = await open([...world, ev(friend, 'friend note', { created_at: 8000 })])
    await a.go('#/'); await tick(400)
    const card = [...a.root.querySelectorAll('article.note')].find((n) => n.textContent!.includes('friend note'))!
    const items = menu(card); expect(items).not.toContain('Delete note'); expect(items.some((x) => x!.startsWith('Mute'))).toBe(true)
  })
})

describe('mentioning someone while writing', () => {
  it('"@an" offers the accounts named like that (people you follow first); a tap puts nostr:npub… in its place, and the note tags them', async () => {
    const sg = fakeSigner(); const a = boot({ events: [...world, ev(friend, JSON.stringify({ name: 'Ana' }), { kind: 0 }), ev(other, JSON.stringify({ name: 'Andrés' }), { kind: 0 }), ev(friend, 'hi', { created_at: 8000 }), ev(other, 'yo', { created_at: 8100 })], signer: sg, stored: { me, settings: JSON.stringify({ rules: { repeatedText: true, burst: true, linkOnly: true, mentionFlood: true, notText: true, outsideNetwork: false }, maxDistance: 2, burstEvents: 5 }) } }); await tick(100); await connectClave(a, sg); await tick(400)
    a.root.querySelector<HTMLElement>('button.fab')!.click(); await tick(60)
    const area = a.root.querySelector('.composer textarea') as HTMLTextAreaElement
    area.value = 'hello @an'; area.selectionStart = area.selectionEnd = area.value.length; area.dispatchEvent(new Event('input'))
    const box = a.root.querySelector('.mention-suggest') as HTMLElement; expect(box.hidden).toBe(false)
    const options = [...box.querySelectorAll('button')]; expect(options.map((b) => b.querySelector('.mention-name')!.textContent)).toEqual(['Ana']); expect(options[0]!.textContent).toContain('you follow') // only names Quill already knows
    options[0]!.click()
    expect(area.value).toBe(`hello nostr:${nip19.npubEncode(friend)} `); expect(box.hidden).toBe(true)
    area.value += 'how are you?'; area.dispatchEvent(new Event('input'))
    await click(a.root, 'Review'); await tick(60); await click(a.root, 'Publish'); await tick(400)
    expect(a.pub.sent[0]!.event.tags).toContainEqual(['p', friend])
  })
  it('nothing is offered for a plain @ or an email address', async () => {
    const sg = fakeSigner(); const a = boot({ events: [...world, ev(friend, JSON.stringify({ name: 'Ana' }), { kind: 0 })], signer: sg, stored: { me } }); await tick(100); await connectClave(a, sg); await tick(300)
    a.root.querySelector<HTMLElement>('button.fab')!.click(); await tick(60)
    const area = a.root.querySelector('.composer textarea') as HTMLTextAreaElement
    for (const text of ['write to me@ana', '@']) { area.value = text; area.selectionStart = area.selectionEnd = text.length; area.dispatchEvent(new Event('input')); expect((a.root.querySelector('.mention-suggest') as HTMLElement).hidden, text).toBe(true) }
  })
})

describe('mention suggestions match the start of a word', () => {
  it('"@der" offers Derek, not Wilder', async () => {
    const d = pk('d'), w = pk('e')
    const sg = fakeSigner(); const a = boot({ events: [list(me, 3, [['p', d], ['p', w]]), ev(d, JSON.stringify({ name: 'Derek Ross' }), { kind: 0 }), ev(w, JSON.stringify({ name: 'Wilder' }), { kind: 0 }), ev(d, 'x', { created_at: 8000 }), ev(w, 'y', { created_at: 8100 })], signer: sg, stored: { me } }); await tick(100); await connectClave(a, sg); await tick(400)
    a.root.querySelector<HTMLElement>('button.fab')!.click(); await tick(300)
    const area = a.root.querySelector('.composer textarea') as HTMLTextAreaElement
    area.value = '@der'; area.selectionStart = area.selectionEnd = 4; area.dispatchEvent(new Event('input'))
    expect([...a.root.querySelectorAll('.mention-suggest .mention-name')].map((x) => x.textContent)).toEqual(['Derek Ross'])
    area.value = '@ros'; area.selectionStart = area.selectionEnd = 4; area.dispatchEvent(new Event('input'))
    expect([...a.root.querySelectorAll('.mention-suggest .mention-name')].map((x) => x.textContent)).toEqual(['Derek Ross']) // any word of the name
  })
})

describe('drafts', () => {
  const open = async () => { const sg = fakeSigner(); const a = boot({ events: [...world, ev(friend, 'a note to answer', { created_at: 8000 })], signer: sg }); await tick(100); await connectClave(a, sg); await tick(300); return a }
  const area = (a: ReturnType<typeof boot>) => a.root.querySelector('.composer textarea') as HTMLTextAreaElement
  const type = (a: ReturnType<typeof boot>, text: string) => { area(a).value = text; area(a).dispatchEvent(new Event('input')) }
  it('what is typed is kept: closing the box and opening it again brings it back, said so, with Discard', async () => {
    const a = await open()
    a.root.querySelector<HTMLElement>('button.fab')!.click(); await tick(60); type(a, 'half a thought')
    await click(a.root, 'Cancel'); expect(a.text()).toContain('Kept as a draft')
    a.root.querySelector<HTMLElement>('button.fab')!.click(); await tick(60)
    expect(area(a).value).toBe('half a thought'); expect(a.root.querySelector('.draft-line')!.textContent).toContain('Draft restored.')
    await click(a.root.querySelector('.draft-line') as HTMLElement, 'Discard'); expect(area(a).value).toBe(''); expect(a.root.querySelector('.draft-line')).toBeNull()
    await click(a.root, 'Cancel'); a.root.querySelector<HTMLElement>('button.fab')!.click(); await tick(60); expect(area(a).value).toBe('')
  })
  it('it survives closing Quill (it is on the device), and publishing deletes it', async () => {
    const a = await open()
    a.root.querySelector<HTMLElement>('button.fab')!.click(); await tick(60); type(a, 'written before a crash')
    const sg = fakeSigner(); const b = boot({ events: world, signer: sg, stored: Object.fromEntries(a.mem) }); await tick(100); await connectClave(b, sg); await tick(300)
    b.root.querySelector<HTMLElement>('button.fab')!.click(); await tick(60); expect(area(b).value).toBe('written before a crash')
    await click(b.root, 'Review'); await tick(60); await click(b.root, 'Publish'); await tick(400)
    expect(b.pub.sent[0]!.event.content).toBe('written before a crash'); expect(b.mem.has(`drafts:${me}`)).toBe(false)
  })
  it('Me lists the drafts: a reply opens again with its text, and one can be thrown away', async () => {
    const a = await open()
    const card = [...a.root.querySelectorAll('article.note')].find((n) => n.textContent!.includes('a note to answer'))!
    await click(card as HTMLElement, 'Reply'); await tick(60); type(a, 'my unfinished reply'); await click(a.root, 'Cancel')
    a.root.querySelector<HTMLElement>('button.fab')!.click(); await tick(60); type(a, 'a loose idea'); await click(a.root, 'Cancel')
    await a.go('#/me'); await tick(300)
    const box = a.root.querySelector('section.drafts')!; expect(box.querySelector('h2')!.textContent).toBe('Drafts (2)')
    expect(box.textContent).toContain('my unfinished reply'); expect(box.textContent).toContain('a loose idea')
    const item = (text: string) => [...box.querySelectorAll('li')].find((l) => l.textContent!.includes(text)) as HTMLElement
    await click(item('a loose idea'), 'Discard'); await tick(60)
    expect(a.root.querySelector('section.drafts h2')!.textContent).toBe('Drafts (1)')
    await click([...a.root.querySelectorAll('section.drafts li')][0] as HTMLElement, 'Keep writing'); await tick(300)
    expect(area(a).value).toBe('my unfinished reply'); expect(a.root.querySelector('.composer')!.textContent).toContain('a note to answer')
  })
  it('a reply has its own draft, apart from a new note', async () => {
    const a = await open()
    a.root.querySelector<HTMLElement>('button.fab')!.click(); await tick(60); type(a, 'a new note'); await click(a.root, 'Cancel')
    const card = [...a.root.querySelectorAll('article.note')].find((n) => n.textContent!.includes('a note to answer'))!
    await click(card as HTMLElement, 'Reply'); await tick(60); expect(area(a).value).toBe(''); type(a, 'my reply'); await click(a.root, 'Cancel')
    a.root.querySelector<HTMLElement>('button.fab')!.click(); await tick(60); expect(area(a).value).toBe('a new note'); await click(a.root, 'Cancel')
    await click(card as HTMLElement, 'Reply'); await tick(60); expect(area(a).value).toBe('my reply')
  })
})

describe('typing while the page fills in', () => {
  it('a redraw of the page gives the cursor back to the box being written in, at the same place', async () => {
    const sg = fakeSigner(); const a = boot({ events: world, signer: sg }); await tick(100); await connectClave(a, sg); await tick(300)
    a.root.querySelector<HTMLElement>('button.fab')!.click(); await tick(60)
    const before = a.root.querySelector('.composer textarea') as HTMLTextAreaElement
    before.focus(); before.value = 'hello world'; before.dispatchEvent(new Event('input')); before.setSelectionRange(5, 5)
    ;(sg.raw as unknown as { approve: () => void }).approve(); await tick(400) // the signer says it is connected again: the app checks and loads, drawing the page again
    expect(a.root.querySelector('.composer textarea')).not.toBe(before) // the box was rebuilt
    const after = a.root.querySelector('.composer textarea') as HTMLTextAreaElement
    expect(document.activeElement).toBe(after); expect(after.value).toBe('hello world'); expect(after.selectionStart).toBe(5)
  })
})

describe('zaps paid with the reader\'s wallet (NWC)', () => {
  const walletPk = 'c'.repeat(64), secret = 'd'.repeat(64)
  const nwc = `nostr+walletconnect://${walletPk}?relay=wss%3A%2F%2Frelay.wallet.example&secret=${secret}`
  const profile = ev(friend, JSON.stringify({ name: 'Ana', lud16: 'ana@pay.example' }), { kind: 0 })
  const lnServer = (invoice: string) => {
    const asked: string[] = []
    return { asked, getJson: async (u: string) => { asked.push(u); return u.startsWith('https://pay.example/.well-known/lnurlp/ana') ? { tag: 'payRequest', callback: 'https://pay.example/cb', minSendable: 1000, maxSendable: 1e9, allowsNostr: true, nostrPubkey: 'e'.repeat(64) } : { pr: invoice } } }
  }
  const wallet = () => { const calls: { method: string; params?: Record<string, unknown> }[] = []; return { calls, nwc: async (_c: unknown, method: string, params?: Record<string, unknown>) => { calls.push({ method, ...(params ? { params } : {}) }); return method === 'get_balance' ? { balance: 50_000_000 } : { preimage: 'ff' } } } }

  it('Settings: the risk is said before pasting; the string is kept on this device; Test asks the wallet; Remove forgets it', async () => {
    const sg = fakeSigner(), w = wallet(), ln = lnServer('lnbc1u1p')
    const a = boot({ signer: sg, events: [...world, profile], zapNet: { getJson: ln.getJson, nwc: w.nwc as never } }); await tick(100); await connectClave(a, sg)
    await a.go('#/settings'); await tick(50)
    expect(a.text()).toContain('lets whoever has it SPEND from your wallet')
    const input = a.root.querySelector('input.nwc-input') as HTMLInputElement; expect(input.type).toBe('password')
    input.value = 'nostr+walletconnect://nonsense'; input.closest('form')!.dispatchEvent(new Event('submit')); await tick()
    expect(a.text()).toContain('That is not a Nostr Wallet Connect string'); expect(a.mem.has(`nwc:${me}`)).toBe(false)
    ;(a.root.querySelector('input.nwc-input') as HTMLInputElement).value = nwc; a.root.querySelector('input.nwc-input')!.closest('form')!.dispatchEvent(new Event('submit')); await tick(80)
    expect(a.mem.get(`nwc:${me}`)).toBe(nwc); expect(w.calls[0]!.method).toBe('get_balance'); expect(a.text()).toContain('50,000 sats available'); expect(a.text()).toContain('relay.wallet.example')
    await click(a.root, 'Remove from this device'); expect(a.mem.has(`nwc:${me}`)).toBe(false)
  })

  it('a zap: pick an amount, sign the request (never published), get the invoice for exactly that amount, the wallet pays it', async () => {
    const sg = fakeSigner(), w = wallet(), ln = lnServer('lnbc1u1pexample') // 1u = 100 sats
    const a = boot({ signer: sg, events: [...world, profile], stored: { me, [`nwc:${me}`]: nwc }, zapNet: { getJson: ln.getJson, nwc: w.nwc as never } }); await tick(100); await connectClave(a, sg); await tick(100)
    const card = [...a.root.querySelectorAll('article.note')].find((n) => n.textContent!.includes('my friend'))!
    ;(card.querySelector('button.zap-btn') as HTMLElement).click(); await tick()
    expect(a.text()).toContain('Zap Ana'); await click(a.root, '100')
    ;(a.root.querySelector('input.zap-comment') as HTMLInputElement).value = 'great'; a.root.querySelector('input.zap-comment')!.dispatchEvent(new Event('input'))
    await click(a.root, 'Zap 100 sats'); await tick(150)
    expect(sg.log).toContain('sign 9734'); expect(a.pub.sent.some((x) => x.event.kind === 9734)).toBe(false) // signed, not published
    const cb = new URL(ln.asked[1]!); expect(cb.searchParams.get('amount')).toBe('100000')
    const req = JSON.parse(cb.searchParams.get('nostr')!); expect(req.kind).toBe(9734); expect(req.content).toBe('great'); expect(req.tags).toContainEqual(['e', post.id]); expect(req.tags).toContainEqual(['p', friend]); expect(req.tags).toContainEqual(['amount', '100000'])
    expect(w.calls).toEqual([{ method: 'pay_invoice', params: { invoice: 'lnbc1u1pexample' } }])
    expect(a.text()).toContain('100 sats sent to Ana')
  })

  it('an invoice for another amount is not paid; an account with no Lightning address is said; my own notes offer no zap', async () => {
    const sg = fakeSigner(), w = wallet(), ln = lnServer('lnbc5u1pexample') // 500, not 21
    const mine = ev(me, 'my own words', { created_at: 1_699_999_500 })
    const a = boot({ signer: sg, events: [...world, profile, mine], stored: { me, [`nwc:${me}`]: nwc }, zapNet: { getJson: ln.getJson, nwc: w.nwc as never } }); await tick(100); await connectClave(a, sg); await tick(100)
    const card = (t: string) => [...a.root.querySelectorAll('article.note')].find((n) => n.textContent!.includes(t))!
    expect(card('my own words').querySelector('button.zap-btn')).toBeNull()
    ;(card('my friend').querySelector('button.zap-btn') as HTMLElement).click(); await tick(); await click(a.root, 'Zap 21 sats'); await tick(150)
    expect(a.text()).toContain('The invoice did not ask for the amount you chose: nothing was paid.'); expect(w.calls).toEqual([])
    await click(a.root, 'Cancel')
    const noAddress = ev(friend, JSON.stringify({ name: 'Ana' }), { kind: 0, created_at: 1_700_000_100 }) // a newer profile, without an address
    const b = boot({ signer: sg, // the same signer, already connected
      events: [...world, profile, noAddress], stored: { me, [`nwc:${me}`]: nwc }, zapNet: { getJson: ln.getJson, nwc: w.nwc as never } }); await tick(100); await b.go('#/'); await tick(150)
    ;([...b.root.querySelectorAll('article.note')].find((n) => n.textContent!.includes('my friend'))!.querySelector('button.zap-btn') as HTMLElement).click(); await tick(); await click(b.root, 'Zap 21 sats'); await tick(150)
    expect(b.text()).toContain('no Lightning address in its profile'); expect(w.calls).toEqual([])
  })

  it('your own zap on someone else\'s note counts in its ⚡, with your name, and its button is lit', async () => {
    const sk = generateSecretKey(), mine = getPublicKey(sk) // a real key: the zap request inside the receipt must be validly signed to name its sender
    const req = finalizeEvent({ kind: 9734, created_at: 1, content: '', tags: [['e', post.id], ['p', friend], ['amount', '21000']] }, sk)
    const receipt = ev(pk('e'), '', { kind: 9735, created_at: 1_699_999_100, tags: [['e', post.id], ['p', friend], ['bolt11', 'lnbc210n1pexample'], ['description', JSON.stringify(req)]] })
    const sg = fakeSigner({ pubkey: mine })
    const a = boot({ signer: sg, events: [...world, list(mine, 3, [['p', friend]]), profile, receipt, ev(mine, JSON.stringify({ name: 'Raúl' }), { kind: 0 })], stored: { me: mine, [`nwc:${mine}`]: nwc } }); await tick(100); await connectClave(a, sg); await tick(900)
    const card = [...a.root.querySelectorAll('article.note')].find((n) => n.textContent!.includes('my friend'))!
    expect(card.querySelector('.reach')!.getAttribute('aria-label')).toBe('1 zap (21 sats)')
    ;(card.querySelector('button.reach') as HTMLElement).click(); expect(card.querySelector('.reach-who')!.textContent).toContain('Raúl · 21 sats')
    const zb = card.querySelector('button.zap-btn')!; expect(zb.classList.contains('on')).toBe(true); expect(zb.getAttribute('aria-label')).toContain('You zapped this note')
  })

  it('without a wallet on this device there is no zap button', async () => {
    const sg = fakeSigner(); const a = boot({ signer: sg, events: [...world, profile] }); await tick(100); await connectClave(a, sg); await tick(100)
    expect(a.root.querySelector('button.zap-btn')).toBeNull(); expect(a.root.querySelector('.actions')).not.toBeNull()
  })
})
