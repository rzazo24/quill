// @vitest-environment happy-dom
import { nip19, type Event, type Filter } from 'nostr-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { ev, pk } from '../core/testutil.js'
import { answers, type Fetcher } from '../net/fetcher.js'
import { parseRoute, startApp } from './app.js'

const me = pk('1'), friend = pk('a'), far = pk('f')
const list = (owner: string, kind: number, tags: string[][]) => ev(owner, '', { kind, tags })
const world: Event[] = [
  list(me, 3, [['p', friend]]), list(friend, 3, []),
  ev(friend, 'a post from my friend'), ev(friend, 'hello', { kind: 0, content: JSON.stringify({ name: 'Ana' }) }),
  ev(far, 'a pitch from a stranger', { tags: [['p', me]] }),
]
const relays = (events: Event[], delayMs = 0): Fetcher => ({ query: async (f: Filter) => { if (delayMs) await new Promise((r) => setTimeout(r, delayMs)); return events.filter((e) => answers(f, e)) } })
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms))
const roots: HTMLElement[] = []

function boot(opts: { events?: Event[]; delayMs?: number; stored?: Record<string, string>; languages?: string[]; env?: { ios: boolean; standalone: boolean }; clock?: { now: number }; newer?: { value: boolean }; reachable?: (url: string) => boolean; goBack?: () => void } = {}) {
  const root = document.createElement('div'); document.body.append(root); roots.push(root)
  const location = { hash: '' }, listeners: (() => void)[] = []
  const mem = new Map(Object.entries(opts.stored ?? {})), visible: (() => void)[] = [], ticks: (() => void)[] = [], polls: (() => void)[] = [], reloads = { n: 0 }, asked = { n: 0 }, setRelays: string[][] = [], base = relays(opts.events ?? world, opts.delayMs), calls = { n: 0 }
  startApp(root, {
    fetcher: { query: (f) => { calls.n++; return base.query(f) } }, env: opts.env, goBack: opts.goBack, nowMs: opts.clock ? () => opts.clock!.now : undefined, onVisible: (cb) => visible.push(cb), onTick: (cb) => ticks.push(cb), onPoll: (cb) => polls.push(cb), setRelays: (l) => setRelays.push(l), probeRelay: async (u) => (opts.reachable ?? (() => true))(u), reload: () => { reloads.n++ },
    checkVersion: opts.newer ? async () => { asked.n++; return opts.newer!.value } : undefined, languages: opts.languages ?? ['en'], location, onHash: (cb) => listeners.push(cb), setHash: (h) => { location.hash = h; listeners.forEach((l) => l()) },
    storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) },
  })
  const go = async (hash: string) => { location.hash = hash; listeners.forEach((l) => l()); await tick() }
  return { root, go, mem, calls, setRelays, reloads, asked, tick: () => ticks.forEach((t) => t()), poll: () => polls.forEach((t) => t()), comeBack: () => visible.forEach((v) => v()), text: () => root.textContent ?? '' }
}
afterEach(() => { roots.forEach((r) => r.remove()); roots.length = 0 })

describe('routes', () => {
  it('parses the hash, including note ids in hex, note1 and nevent1', () => {
    const id = 'c'.repeat(64)
    expect(parseRoute('')).toEqual({ name: 'following' }); expect(parseRoute('#/mentions')).toEqual({ name: 'mentions' }); expect(parseRoute('#/nonsense')).toEqual({ name: 'following' })
    expect(parseRoute('#/note/' + id)).toEqual({ name: 'note', id })
    expect(parseRoute('#/note/' + nip19.noteEncode(id))).toEqual({ name: 'note', id })
    expect(parseRoute('#/note/' + nip19.neventEncode({ id }))).toEqual({ name: 'note', id })
    expect(parseRoute('#/note/garbage')).toEqual({ name: 'following' })
    const from = 'd'.repeat(64)
    expect(parseRoute(`#/note/${id}?from=${from}`)).toEqual({ name: 'note', id, from }); expect(parseRoute(`#/note/${nip19.noteEncode(id)}?from=${from.toUpperCase()}`)).toEqual({ name: 'note', id, from })
    expect(parseRoute(`#/note/${id}?from=garbage`)).toEqual({ name: 'note', id }); expect(parseRoute(`#/note/${id}?from=${id}`)).toEqual({ name: 'note', id }) // a bad or self reference is ignored, the note still opens
  })
})

describe('the app', () => {
  it('starts at the login, refuses junk and private keys, and never stores them', async () => {
    const a = boot()
    expect(a.text()).toContain('Read as…')
    const input = a.root.querySelector('input')!, form = a.root.querySelector('form')!
    for (const bad of ['hello', 'nsec1' + 'q'.repeat(58)]) {
      input.value = bad; form.dispatchEvent(new Event('submit', { cancelable: true })); await tick(5)
      expect(a.root.querySelector('.error')).not.toBeNull()
    }
    expect(a.mem.size).toBe(0)
  })
  it('logs in with an npub, shows the feed, remembers who you are', async () => {
    const a = boot()
    a.root.querySelector('input')!.value = nip19.npubEncode(me)
    a.root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await tick(80)
    expect(a.text()).toContain('a post from my friend'); expect(a.text()).toContain('Ana')
    expect(a.mem.get('me')).toBe(me)
  })
  it('starts straight on the feed when it remembers you, in the browser\'s language', async () => {
    const a = boot({ stored: { me }, languages: ['es-ES'] }); await tick(80)
    expect(a.text()).toContain('Siguiendo'); expect(a.text()).toContain('a post from my friend')
  })
  it('switching tab does not leave the old tab\'s notes on screen while the new one loads', async () => {
    const a = boot({ stored: { me }, delayMs: 40 }); await tick(400)
    expect(a.text()).toContain('a post from my friend')
    await a.go('#/mentions')
    expect(a.text()).not.toContain('a post from my friend')
    await tick(400)
    expect(a.text()).toContain('a pitch from a stranger') // folded, but present
    expect(a.root.querySelectorAll('details.folded').length).toBe(1)
    expect(a.text()).toContain('1 outside your network')
  })
  it('changing language redraws the content already on screen', async () => {
    const a = boot({ stored: { me } }); await tick(80)
    await a.go('#/mentions'); await tick(60)
    expect(a.text()).toMatch(/No path from you/)
    ;[...a.root.querySelectorAll('button')].find((b) => b.textContent === 'ES')!.click(); await tick(80)
    expect(a.text()).toMatch(/No hay camino desde ti/); expect(a.text()).not.toMatch(/No path from you/)
    expect(a.mem.get('lang')).toBe('es')
  })
  it('turning a rule off re-judges: the stranger is no longer folded', async () => {
    const a = boot({ stored: { me } }); await tick(80); await a.go('#/mentions'); await tick(60)
    expect(a.root.querySelectorAll('details.folded').length).toBe(1)
    ;[...a.root.querySelectorAll('button')].find((b) => b.textContent === 'Filter settings')!.click(); await tick(80) // the summary's button takes you to the Me page, where the settings are
    expect(a.root.querySelector('.settings')).not.toBeNull()
    const box = [...a.root.querySelectorAll('label.check')].find((l) => l.textContent?.includes('Outside your network'))!.querySelector('input')!
    box.checked = false; box.dispatchEvent(new Event('change')); await tick(80)
    await a.go('#/mentions'); await tick(60)
    expect(a.root.querySelectorAll('details.folded').length).toBe(0)
    expect(JSON.parse(a.mem.get('settings')!).rules.outsideNetwork).toBe(false)
  })
  it('the tagline is on the login card (the header hides it on a phone), in the reader\'s language', async () => {
    const en = boot({}); await tick(40); expect(en.root.querySelector('.login .tagline')!.textContent).toBe('Text only. Tells you why it hides things.')
    const es = boot({ languages: ['es'] }); await tick(40); expect(es.root.querySelector('.login .tagline')!.textContent).toBe('Solo texto. Te dice por qué oculta cosas.')
  })
  it('has three tabs at the bottom: Following, Mentions and Me; the current one is marked', async () => {
    const a = boot({ stored: { me } }); await tick(80)
    const tabs = () => [...a.root.querySelectorAll('nav.tabbar a')].map((x) => `${x.textContent}${x.getAttribute('aria-current') ? '*' : ''}`)
    expect(tabs()).toEqual(['Following*', 'Mentions', 'Me'])
    await a.go('#/mentions'); expect(tabs()).toEqual(['Following', 'Mentions*', 'Me'])
    await a.go('#/me'); expect(tabs()).toEqual(['Following', 'Mentions', 'Me*'])
    const login = boot({}); await tick(40); expect(login.root.querySelector('nav.tabbar')).toBeNull() // no tabs before you are logged in
  })
  it('the Me page shows who you are, your own notes (replies included) and sign out; the settings are NOT there any more', async () => {
    const mineRoot = ev(me, 'a note I wrote', { created_at: 3000 }), mineReply = ev(me, 'a reply I wrote', { created_at: 4000, tags: [['e', 'e'.repeat(64), '', 'root']] })
    const a = boot({ events: [...world, mineRoot, mineReply, ev(me, JSON.stringify({ name: 'Raúl' }), { kind: 0 })], stored: { me } }); await tick(80); await a.go('#/me'); await tick(60)
    expect(a.text()).toContain('Raúl'); expect(a.root.querySelector('.account .avatar')!.textContent).toBe('RA')
    expect(a.text()).toContain('My notes'); expect(a.text()).toContain('a note I wrote'); expect(a.text()).toContain('a reply I wrote')
    expect(a.root.querySelector('.settings, .prefs')).toBeNull(); expect(a.text()).toContain('Sign out')
  })
  it('every note has a generated avatar: colour from the key, initials from the name, nothing loaded', async () => {
    const a = boot({ stored: { me } }); await tick(80)
    const av = a.root.querySelector('article.note .avatar') as HTMLElement
    expect(av.textContent).toMatch(/^[A-Z0-9]{2}$/); expect(av.style.getPropertyValue('--h')).toMatch(/^\d+$/); expect(a.root.querySelectorAll('img, [src]').length).toBe(0)
  })
  it('an installed app has no pull-to-refresh: the header button and re-tapping the current tab read everything again', async () => {
    const a = boot({ stored: { me } }); await tick(100)
    const base = a.calls.n; expect(base).toBeGreaterThan(0)
    ;(a.root.querySelector('button.icon') as HTMLElement).click(); await tick(100)
    const afterButton = a.calls.n; expect(afterButton).toBeGreaterThan(base)
    const current = a.root.querySelector('nav.tabbar a[aria-current]') as HTMLElement
    const ev2 = new Event('click', { cancelable: true, bubbles: true }); current.dispatchEvent(ev2); await tick(100)
    expect(ev2.defaultPrevented).toBe(true); expect(a.calls.n).toBeGreaterThan(afterButton)
    const other = a.root.querySelector('nav.tabbar a:not([aria-current])') as HTMLElement
    const ev3 = new Event('click', { cancelable: true, bubbles: true }); other.dispatchEvent(ev3); expect(ev3.defaultPrevented).toBe(false) // another tab navigates normally
  })
  it('coming back to the app after a few minutes refreshes it; after a few seconds it does not', async () => {
    const clock = { now: 1_700_000_000_000 }; const a = boot({ stored: { me }, clock }); await tick(100)
    const base = a.calls.n
    clock.now += 30_000; a.comeBack(); await tick(100); expect(a.calls.n).toBe(base) // 30 s: nothing to do
    clock.now += 5 * 60_000; a.comeBack(); await tick(100); expect(a.calls.n).toBeGreaterThan(base) // 5 min: fresh notes
  })
  it('the install hint shows on the Me page for iPhone Safari only, never once installed, never on a computer', async () => {
    const shows = async (env: { ios: boolean; standalone: boolean } | undefined) => { const a = boot({ stored: { me }, env }); await tick(80); await a.go('#/me'); return a.text().includes('Add to Home Screen') }
    expect(await shows({ ios: true, standalone: false })).toBe(true)
    expect(await shows({ ios: true, standalone: true })).toBe(false)
    expect(await shows({ ios: false, standalone: false })).toBe(false)
    expect(await shows(undefined)).toBe(false)
  })
  it('tells you when a newer version of the app is on the server, and the button reloads it', async () => {
    const newer = { value: false }; const a = boot({ stored: { me }, newer }); await tick(100)
    expect(a.root.querySelector('.update')).toBeNull(); expect(a.asked.n).toBeGreaterThan(0) // asked once at start: nothing new
    newer.value = true; a.tick(); await tick(60) // the clock ticks (every ten minutes in the real app)
    const banner = a.root.querySelector('.update')!; expect(banner.textContent).toContain('A new version of Quill is available.')
    ;(banner.querySelector('button') as HTMLElement).click(); expect(a.reloads.n).toBe(1)
  })
  it('it also asks when the app comes back to the foreground, and the banner speaks your language', async () => {
    const newer = { value: false }; const a = boot({ stored: { me }, newer, languages: ['es'] }); await tick(100)
    const before = a.asked.n; newer.value = true; a.comeBack(); await tick(60)
    expect(a.asked.n).toBeGreaterThan(before); expect(a.root.querySelector('.update')!.textContent).toContain('Hay una nueva versión de Quill.')
  })
  it('no banner when the server has nothing newer, and once shown it does not ask again', async () => {
    const newer = { value: false }; const a = boot({ stored: { me }, newer }); await tick(100)
    a.tick(); a.comeBack(); await tick(60); expect(a.root.querySelector('.update')).toBeNull()
    newer.value = true; a.tick(); await tick(60); const asked = a.asked.n; a.tick(); a.comeBack(); await tick(60)
    expect(a.asked.n).toBe(asked); expect(a.root.querySelectorAll('.update').length).toBe(1)
  })
  it('without the check (a build that does not offer it) there is no banner and nothing breaks', async () => {
    const a = boot({ stored: { me } }); await tick(100); a.tick(); a.comeBack(); expect(a.root.querySelector('.update')).toBeNull()
  })
  it('survives a hostile note, junk in storage, and relays that return nothing', async () => {
    const evil = ev(friend, '<img src=x onerror=alert(1)> <script>x</script>')
    const a = boot({ events: [...world, evil], stored: { me, settings: '{"rules":42,"maxDistance":"x"}', lang: 'zz', words: '\n\n  ' } }); await tick(80)
    expect(a.root.querySelectorAll('img, script, [onerror]').length).toBe(0); expect(a.text()).toContain('<img src=x')
    const b = boot({ events: [], stored: { me } }); await tick(80)
    expect(b.text()).toContain('Nothing here yet')
  })
  it('a slow answer for a tab you already left does not overwrite the tab you are on', async () => {
    const root = document.createElement('div'); document.body.append(root); roots.push(root)
    const location = { hash: '' }, listeners: (() => void)[] = []
    const slowMentions: Fetcher = { query: async (f) => { if (f['#p']) await new Promise((r) => setTimeout(r, 200)); return world.filter((e) => answers(f, e)) } }
    startApp(root, { fetcher: slowMentions, languages: ['en'], location, onHash: (cb) => listeners.push(cb), setHash: () => {}, storage: { getItem: (k) => (k === 'me' ? me : null), setItem: () => {}, removeItem: () => {} } })
    await tick(80)
    location.hash = '#/mentions'; listeners.forEach((l) => l()); await tick(20)
    location.hash = '#/'; listeners.forEach((l) => l()); await tick(400) // the mentions answer arrives meanwhile
    expect(root.textContent).toContain('a post from my friend')
    expect(root.textContent).not.toContain('a pitch from a stranger')
  })
  it('signing out forgets you', async () => {
    const a = boot({ stored: { me } }); await tick(80); await a.go('#/me')
    ;[...a.root.querySelectorAll('button')].find((b) => b.textContent === 'Sign out')!.click(); await tick(10)
    expect(a.text()).toContain('Read as…'); expect(a.mem.has('me')).toBe(false)
  })
})

describe('notifications inside the app', () => {
  const NOW = 10_000
  const myNote = ev(me, 'my note', { created_at: 100 })
  const base = (): Event[] => [list(me, 3, [['p', friend]]), list(friend, 3, []), ev(friend, 'hi', { kind: 0, content: JSON.stringify({ name: 'Ana' }) }), myNote]
  const reply = (who: string, text: string, at: number) => ev(who, text, { created_at: at, tags: [['e', myNote.id, '', 'root'], ['p', me]] })
  const react = (who: string, at: number, content = '❤️') => ev(who, content, { kind: 7, created_at: at, tags: [['e', myNote.id], ['p', me]] })
  const badge = (a: ReturnType<typeof boot>) => a.root.querySelector('.tabbar .badge')?.textContent ?? null
  const start = (events: Event[], seen: number | null = 5000) => boot({ events, clock: { now: NOW * 1000 }, stored: { me, ...(seen ? { [`seen:${me}`]: String(seen)} : {}) } })

  it('shows a number on Mentions for what is new since the last visit, counting replies, mentions and reactions the filter lets through', async () => {
    const a = start([...base(), reply(friend, 'new reply', 6000), reply(friend, 'old reply', 4000), react(friend, 6100)]); await tick(150)
    expect(badge(a)).toBe('2') // the new reply + the reaction (the old reply is not new)
  })
  it('nothing the filter hides is counted', async () => {
    const a = start([...base(), reply(far, 'buy my thing now', 6000), react(far, 6000, '🔥')]); await tick(150)
    expect(badge(a)).toBeNull()
  })
  it('the number is capped at 9+', async () => {
    const many = Array.from({ length: 12 }, (_, i) => reply(friend, `reply number ${i}`, 6000 + i)); const a = start([...base(), ...many]); await tick(150)
    expect(badge(a)).toBe('9+')
  })
  it('the very first run does not greet with a pile: it starts counting from now', async () => {
    const a = start([...base(), reply(friend, 'something older', 6000)], null); await tick(150)
    expect(badge(a)).toBeNull(); expect(a.mem.get(`seen:${me}`)).toBe(String(NOW))
  })
  it('the periodic look picks up a new arrival, and opening Mentions clears the number and remembers the visit', async () => {
    const events = [...base()]; const a = start(events); await tick(150); expect(badge(a)).toBeNull()
    events.push(reply(friend, 'a fresh one', 9000)); a.poll(); await tick(150); expect(badge(a)).toBe('1')
    await a.go('#/mentions'); await tick(150)
    expect(badge(a)).toBeNull(); expect(a.mem.get(`seen:${me}`)).toBe(String(NOW))
    expect(a.root.querySelector('article.note.new')?.textContent).toContain('a fresh one') // marked as new while you are looking at it
  })
  it('the Mentions view lists who reacted to your notes, and marks notes already seen as not new', async () => {
    const a = start([...base(), react(friend, 6100, '🔥'), reply(friend, 'seen before', 4000)]); await tick(150); await a.go('#/mentions'); await tick(150)
    const block = a.root.querySelector('.reacted')!; expect(block.textContent).toContain('Reactions to your notes'); expect(block.textContent).toContain('Ana reacted to your note'); expect(block.textContent).toContain('my note')
    expect(block.querySelector('a.reaction-line.fresh')).not.toBeNull(); expect(block.querySelector('.emojis')!.textContent).toBe('🔥')
    expect(block.querySelector('a')!.getAttribute('href')).toBe(`#/note/${myNote.id}`)
    const seen = [...a.root.querySelectorAll('article.note')].find((n) => n.textContent!.includes('seen before'))!; expect(seen.classList.contains('new')).toBe(false)
  })
  it('the line above the list says how many are new and how many new ones the filter hid', async () => {
    const a = start([...base(), reply(friend, 'new reply', 6000), reply(far, 'buy my thing now', 6000)]); await tick(150); await a.go('#/mentions'); await tick(150)
    expect(a.root.querySelector('.new-line')!.textContent).toBe('1 new · hidden by the filter: 1')
  })
  it('no number when you are reading as somebody who has nothing new, and no look is made while Mentions is open', async () => {
    const a = start(base()); await tick(150); await a.go('#/mentions'); await tick(150)
    const before = a.calls.n; a.poll(); await tick(60); expect(a.calls.n).toBe(before); expect(badge(a)).toBeNull(); expect(a.root.querySelector('.reacted')).toBeNull()
  })
})

describe('settings: text size and relays', () => {
  const start = (o: Parameters<typeof boot>[0] = {}) => boot({ ...o, stored: { me, ...(o.stored ?? {}) } })
  const prefs = (a: ReturnType<typeof boot>) => a.root.querySelector('.prefs') as HTMLElement
  const urls = (a: ReturnType<typeof boot>) => [...prefs(a).querySelectorAll('.relay-list .url')].map((x) => x.textContent)
  const add = async (a: ReturnType<typeof boot>, text: string) => { const i = prefs(a).querySelector('.relay-add input') as HTMLInputElement; i.value = text; prefs(a).querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await tick(80) }
  const press = async (a: ReturnType<typeof boot>, label: string) => { const b = [...prefs(a).querySelectorAll('button')].find((x) => x.textContent === label || x.getAttribute('aria-label')?.startsWith(label))!; b.click(); await tick(80) }

  it('the Me page has a Settings section with the default relays and the text-size choices', async () => {
    const a = start(); await a.go('#/settings'); await tick(80)
    expect(urls(a)).toHaveLength(6); expect(urls(a)).toContain('relay.hivescope.xyz'); expect([...prefs(a).querySelectorAll('.seg:not(.avatars) button')].map((b) => b.textContent)).toEqual(['Small', 'Normal', 'Large', 'Very large'])
    expect(a.setRelays.at(-1)).toHaveLength(6); expect(prefs(a).textContent).not.toContain('Restore the default relays')
  })
  it('text size is applied at once, remembered, and restored on the next start', async () => {
    const a = start(); await a.go('#/settings'); await tick(80); expect(document.documentElement.getAttribute('data-font')).toBe('normal')
    await press(a, 'Large'); expect(document.documentElement.getAttribute('data-font')).toBe('large'); expect(a.mem.get('font')).toBe('large'); expect(prefs(a).querySelector('button[aria-pressed=true]')!.textContent).toBe('Large')
    const b = start({ stored: { font: 'xlarge' } }); expect(document.documentElement.getAttribute('data-font')).toBe('xlarge'); void b
    start({ stored: { font: 'gigantic' } }); expect(document.documentElement.getAttribute('data-font')).toBe('normal')
  })
  it('adding a relay stores it, tells the network code, and reads everything again from the new list', async () => {
    const a = start(); await a.go('#/settings'); await tick(80); const before = a.calls.n
    await add(a, 'Relay.Example.com/'); await tick(80)
    expect(urls(a)).toContain('relay.example.com'); expect(urls(a)).toHaveLength(7); expect(JSON.parse(a.mem.get('relays')!)).toContain('wss://relay.example.com'); expect(a.setRelays.at(-1)).toContain('wss://relay.example.com')
    expect(a.calls.n).toBeGreaterThan(before); expect(prefs(a).textContent).toContain('Restore the default relays')
  })
  it('refuses insecure, malformed and repeated addresses, says why, and changes nothing', async () => {
    const a = start(); await a.go('#/settings'); await tick(80); const sets = a.setRelays.length
    for (const [bad, msg] of [['ws://relay.example.com', 'not a valid secure relay'], ['localhost', 'not a valid secure relay'], ['wss://relay.primal.net', 'already in the list']] as const) {
      await add(a, bad); expect(prefs(a).querySelector('[role=alert]')!.textContent).toContain(msg); expect(urls(a)).toHaveLength(6)
    }
    expect(a.mem.has('relays')).toBe(false); expect(a.setRelays).toHaveLength(sets)
  })
  it('a relay can be removed, but never the last one; the defaults can be restored', async () => {
    const a = start({ stored: { relays: JSON.stringify(['wss://a.example.com', 'wss://b.example.com']) } }); await a.go('#/settings'); await tick(80)
    expect(urls(a)).toEqual(['a.example.com', 'b.example.com']); await press(a, 'Remove wss://a.example.com'); expect(urls(a)).toEqual(['b.example.com'])
    expect((prefs(a).querySelector('.relay-list button[aria-label^="Remove"]') as HTMLButtonElement).disabled).toBe(true)
    await press(a, 'Restore the default relays'); expect(urls(a)).toHaveLength(6); expect(a.setRelays.at(-1)).toHaveLength(6); expect(prefs(a).textContent).not.toContain('Restore the default relays')
  })
  it('a corrupt stored list falls back to the defaults', async () => {
    const a = start({ stored: { relays: '{"not":"a list"}' } }); await a.go('#/settings'); await tick(80); expect(urls(a)).toHaveLength(6)
  })
  it('Test says whether a relay answers, per relay', async () => {
    const a = start({ reachable: (u) => u.includes('nos.lol') }); await a.go('#/settings'); await tick(80)
    const row = (name: string) => [...prefs(a).querySelectorAll('.relay-list li')].find((li) => li.textContent!.includes(name))!
    ;(row('nos.lol').querySelector('button') as HTMLElement).click(); ;(row('nostr.mom').querySelector('button') as HTMLElement).click(); await tick(80)
    expect(row('nos.lol').querySelector('.probe')!.textContent).toBe('Answers'); expect(row('nostr.mom').querySelector('.probe')!.textContent).toBe('No answer'); expect(row('nos.lol').querySelector('.probe.up')).not.toBeNull()
  })
})

describe('the settings cog', () => {
  const gear = (a: ReturnType<typeof boot>) => a.root.querySelector('header.top button[aria-label="Settings"]') as HTMLButtonElement | null
  it('sits right after the language buttons (and before the help button), only when somebody is signed in', async () => {
    const out = boot(); expect(gear(out)).toBeNull()
    const a = boot({ stored: { me } }); await tick(80); const header = a.root.querySelector('header.top')!
    const kids = [...header.querySelectorAll('button')]; expect(kids.at(-2)).toBe(gear(a)); expect(kids.at(-1)!.getAttribute('aria-label')).toBe('Help'); expect(kids.at(-3)!.textContent).toBe('ES'); expect(gear(a)!.querySelector('svg')).not.toBeNull()
  })
  it('opens Settings (text size, relays and the filter together); pressing it again goes back to the feed', async () => {
    const a = boot({ stored: { me } }); await tick(80); expect(gear(a)!.getAttribute('aria-pressed')).toBe('false')
    gear(a)!.click(); await tick(80)
    expect(a.root.querySelector('.prefs')).not.toBeNull(); expect(a.root.querySelector('.settings')).not.toBeNull(); expect(a.root.querySelector('.tabbar .tab.on')).toBeNull(); expect(gear(a)!.getAttribute('aria-pressed')).toBe('true')
    gear(a)!.click(); await tick(80); expect(a.root.querySelector('.prefs')).toBeNull(); expect(a.text()).toContain('a post from my friend')
  })
  it('the filter summary button leads to the same Settings page', async () => {
    const a = boot({ stored: { me } }); await tick(80); await a.go('#/mentions'); await tick(80)
    ;(a.root.querySelector('.summary button, button.summary-settings') ?? [...a.root.querySelectorAll('button')].find((b) => b.textContent === 'Filter settings')!).dispatchEvent(new Event('click')); await tick(80)
    expect(a.root.querySelector('.settings')).not.toBeNull(); expect(a.root.querySelector('.prefs')).not.toBeNull() // the same page, text size and relays included
  })
  it('and it lands on the filter section instead of the top of the page', async () => {
    const a = boot({ stored: { me } }); await tick(80); await a.go('#/mentions'); await tick(80)
    const calls: Element[] = []; const orig = Element.prototype.scrollIntoView; Element.prototype.scrollIntoView = function (this: Element) { calls.push(this) }
    try { await a.go('#/settings/filter'); await tick(80) } finally { Element.prototype.scrollIntoView = orig }
    expect(calls.map((c) => c.className)).toContain('settings'); expect(parseRoute('#/settings/filter')).toEqual({ name: 'settings', focus: 'filter' }); expect(parseRoute('#/settings')).toEqual({ name: 'settings' })
  })
})

describe('several loads starting at once (a saved signer session resuming starts a second one)', () => {
  // The bug depended on the exact moment the second load started, so it is tried at many moments while the first one is still reading the account.
  it('the feed still loads when the published relay list is adopted in the middle of it, whenever the second load starts', async () => {
    const list = ev(me, '', { kind: 10002, created_at: 1000, tags: [['r', 'wss://x.example'], ['r', 'wss://y.example']] })
    for (const startAt of [5, 15, 25, 35, 45, 55, 70, 90, 110, 140]) {
      const a = boot({ events: [...world, list], stored: { me }, delayMs: 12 })
      await tick(startAt); a.go('#/') // a second load, startAt ms into the first
      await tick(1200)
      expect(a.text(), `second load at ${startAt} ms`).not.toContain('Could not find that note'); expect(a.text(), `second load at ${startAt} ms`).toContain('a post from my friend')
    }
  }, 60_000)
})

describe('the help page', () => {
  const help = (a: ReturnType<typeof boot>) => a.root.querySelector('header.top button[aria-label="Help"]') as HTMLButtonElement
  const sections = (a: ReturnType<typeof boot>) => [...a.root.querySelectorAll('details.help-section')] as HTMLDetailsElement[]
  it('is the rightmost button of the header, also before signing in, and the same button closes it', async () => {
    const out = boot(); expect(help(out)).not.toBeNull(); help(out).click(); await tick(60)
    expect(sections(out)).toHaveLength(9); expect(out.text()).toContain('What Quill is'); expect(help(out).getAttribute('aria-pressed')).toBe('true')
    help(out).click(); await tick(60); expect(sections(out)).toHaveLength(0); expect(out.text()).toContain('Read as…')
    const a = boot({ stored: { me } }); await tick(80); expect([...a.root.querySelectorAll('header.top button')].map((b) => b.getAttribute('aria-label') ?? b.textContent).slice(-3)).toEqual(['ES', 'Settings', 'Help'])
  })
  it('opens with the first section unfolded; what you unfold stays unfolded when the page redraws', async () => {
    const a = boot({ stored: { me } }); await tick(80); help(a).click(); await tick(60)
    expect(sections(a).map((s) => s.open)).toEqual([true, false, false, false, false, false, false, false, false])
    const filter = sections(a).find((s) => s.dataset.id === 'filter')!; filter.open = true; filter.dispatchEvent(new Event('toggle')); await tick(10)
    ;(a.root.querySelector('.lang button[aria-pressed=false]') as HTMLElement).click(); await tick(80) // language change redraws the whole page
    expect(sections(a).filter((s) => s.open).map((s) => s.dataset.id)).toEqual(['about', 'filter']); expect(a.text()).toContain('Cómo decide el filtro')
  })
  it('the text is shown as text, never as markup', async () => {
    const a = boot({ stored: { me } }); await tick(80); help(a).click(); await tick(60)
    expect(a.root.querySelector('.help script, .help img')).toBeNull(); const links = [...a.root.querySelectorAll('.help a')] as HTMLAnchorElement[]
    expect(links).toHaveLength(1); expect(links[0]!.getAttribute('href')).toBe('https://github.com/rzazo24/quill'); expect(links[0]!.getAttribute('target')).toBe('_blank'); expect(links[0]!.getAttribute('rel')).toBe('noopener noreferrer'); expect(links[0]!.textContent).toBe('github.com/rzazo24/quill'); expect(a.root.querySelectorAll('.help li').length).toBeGreaterThan(20)
  })
})

describe('the logo', () => {
  it('is the quill drawn next to the name, as page elements and not as an image', async () => {
    for (const a of [boot(), boot({ stored: { me } })]) {
      const link = a.root.querySelector('header.top h1 a')!
      expect(link.textContent).toBe('Quill'); expect(link.querySelector('svg.logo')).not.toBeNull(); expect(link.querySelector('svg.logo')!.getAttribute('aria-hidden')).toBe('true'); expect(a.root.querySelectorAll('img').length).toBe(0)
      expect(link.querySelectorAll('svg.logo path')).toHaveLength(3); expect(link.firstElementChild!.tagName.toLowerCase()).toBe('svg') // before the name
    }
  })
})

describe('quoted notes show where you came from', () => {
  const quoted = ev(far, 'the note being quoted', { created_at: 2000 })
  const quoting = ev(friend, `look at this nostr:${nip19.noteEncode(quoted.id)} please`, { created_at: 3000 })
  const feed = (extra: Event[] = []) => [...world, quoted, quoting, ...extra]
  it('the Quoted note button opens that note AND shows the note it was tapped from, above it', async () => {
    const a = boot({ events: feed(), stored: { me } }); await tick(150)
    const chip = [...a.root.querySelectorAll('article.note a.thread-link')].find((c) => c.textContent === 'Quoted note') as HTMLAnchorElement
    expect(chip.getAttribute('href')).toBe(`#/note/${quoted.id}?from=${quoting.id}`)
    await a.go(chip.getAttribute('href')!); await tick(150)
    const source = a.root.querySelector('.quoted-from')!
    expect(source.textContent).toContain('Quoted from this note:'); expect(source.textContent).toContain('look at this'); expect(a.text()).toContain('the note being quoted')
    expect(a.text().indexOf('Quoted from this note')).toBeLessThan(a.text().indexOf('the note being quoted')) // the source first, then the opened note
  })
  it('a note opened without a source shows no such card', async () => {
    const a = boot({ events: feed(), stored: { me } }); await tick(100); await a.go(`#/note/${quoted.id}`); await tick(150)
    expect(a.root.querySelector('.quoted-from')).toBeNull(); expect(a.text()).toContain('the note being quoted')
  })
  it('if the quoted note cannot be found, the source is still shown with the message', async () => {
    const a = boot({ events: [...world, quoting], stored: { me } }); await tick(100); await a.go(`#/note/${quoted.id}?from=${quoting.id}`); await tick(150)
    expect(a.root.querySelector('.quoted-from')!.textContent).toContain('look at this'); expect(a.text()).toContain('Could not find that note')
  })
  it('a source that does not exist is simply left out', async () => {
    const a = boot({ events: feed(), stored: { me } }); await tick(100); await a.go(`#/note/${quoted.id}?from=${'9'.repeat(64)}`); await tick(150)
    expect(a.root.querySelector('.quoted-from')).toBeNull(); expect(a.text()).toContain('the note being quoted')
  })
})

describe('reposts of the people you follow', () => {
  const original = ev(far, 'a note worth sharing', { created_at: 2000 })
  const rp = ev(friend, JSON.stringify(original), { kind: 6, created_at: 1_900_000_000, tags: [['e', original.id], ['p', far]] })
  const rp2 = ev(me, '', { kind: 6, created_at: 1_900_000_100, tags: [['e', original.id], ['p', far]] })
  const feed = [...world, original, rp]
  it('Following shows them, marked with who reposted, at the time of the repost', async () => {
    const a = boot({ events: feed, stored: { me } }); await tick(150)
    const note = [...a.root.querySelectorAll('article.note')].find((n) => n.textContent!.includes('a note worth sharing'))!
    expect(note.querySelector('.reposted')!.textContent).toBe('Ana reposted'); expect(note.querySelector('.reposted svg')).not.toBeNull()
    const order = [...a.root.querySelectorAll('article.note, details.folded')].map((n) => n.textContent!); expect(order.findIndex((t) => t.includes('a note worth sharing'))).toBeLessThan(order.findIndex((t) => t.includes('a post from my friend')))
  })
  it('several reposters are one card: "Ana and 1 more reposted"', async () => {
    const a = boot({ events: [...feed, rp2], stored: { me } }); await tick(150)
    const notes = [...a.root.querySelectorAll('article.note')].filter((n) => n.textContent!.includes('a note worth sharing')); expect(notes).toHaveLength(1)
    expect(notes[0]!.querySelector('.reposted')!.textContent).toMatch(/and 1 more reposted$/)
  })
  it('the filter still judges the note by its author: a stranger\'s reposted note is folded with the reason', async () => {
    const a = boot({ events: feed, stored: { me } }); await tick(150)
    expect(a.root.querySelector('details.folded')!.textContent).toContain('No path from you'); expect(a.root.querySelector('details.folded .reposted')!.textContent).toBe('Ana reposted')
  })
  it('can be switched off in Settings; the choice is remembered and the feed is rebuilt without them', async () => {
    const a = boot({ events: feed, stored: { me } }); await tick(150); expect(a.text()).toContain('a note worth sharing')
    await a.go('#/settings'); await tick(100); const box = [...a.root.querySelectorAll('.prefs label.check input')].find((i) => i.parentElement!.textContent!.includes('repost')) as HTMLInputElement
    expect(box.checked).toBe(true); box.checked = false; box.dispatchEvent(new Event('change')); await tick(100)
    expect(a.mem.get('reposts')).toBe('0'); await a.go('#/'); await tick(150); expect(a.text()).not.toContain('a note worth sharing'); expect(a.root.querySelector('.reposted')).toBeNull()
    const again = boot({ events: feed, stored: { me, reposts: '0' } }); await tick(150); expect(again.text()).not.toContain('a note worth sharing')
  })
  it('reposts are only on Following, not in Mentions or Me', async () => {
    const a = boot({ events: feed, stored: { me } }); await tick(100); await a.go('#/mentions'); await tick(150); expect(a.root.querySelector('.reposted')).toBeNull()
  })
})

describe('the switches in Settings', () => {
  it('every rule and the reposts option is a switch (a checkbox announced as on/off), with the words first and the switch at the end, and one line that says what on and off mean', async () => {
    const a = boot({ stored: { me } }); await tick(80); await a.go('#/settings'); await tick(100)
    const rows = [...a.root.querySelectorAll('label.check')]; expect(rows).toHaveLength(5) // four rules + reposts
    for (const r of rows) { const input = r.querySelector('input')!; expect(input.type).toBe('checkbox'); expect(input.getAttribute('role')).toBe('switch'); expect(r.firstElementChild!.tagName).toBe('SPAN'); expect(r.lastElementChild).toBe(input) }
    expect(a.root.querySelector('.settings .meta')!.textContent).toBe('On = the rule hides what meets its condition. Off = it hides nothing.')
    expect(rows.slice(0, 4).map((r) => (r.querySelector('input') as HTMLInputElement).checked)).toEqual([true, true, true, true]) // all on by default
  })
})

describe('avatar style', () => {
  const people = (a: ReturnType<typeof boot>) => [...a.root.querySelectorAll('article.note > .avatar-link > .avatar')] as HTMLElement[]
  const pick = async (a: ReturnType<typeof boot>, label: string) => { const b = [...a.root.querySelectorAll('.seg.avatars button')].find((x) => x.lastChild!.textContent === label) as HTMLElement; b.click(); await tick(150) }
  it('starts with initials; Settings offers initials, robots and pixels, each with a sample of the reader\'s own picture', async () => {
    const a = boot({ stored: { me } }); await tick(150)
    expect(people(a).length).toBeGreaterThan(0); expect(people(a).every((x) => !x.classList.contains('art') && /^[A-Z0-9]{2}$/.test(x.textContent!))).toBe(true)
    await a.go('#/settings'); await tick(100); const opts = [...a.root.querySelectorAll('.seg.avatars button')]
    expect(opts.map((b) => b.lastChild!.textContent)).toEqual(['Initials', 'Robots', 'Pixels']); expect(opts.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false'])
    expect(opts[1]!.querySelector('.avatar.art svg.robot')).not.toBeNull(); expect(opts[2]!.querySelector('.avatar.art svg.pixel')).not.toBeNull(); expect(opts[0]!.querySelector('.avatar')!.classList.contains('art')).toBe(false)
  })
  it('robots and pixels replace the initials everywhere (cards and the account), as page elements and never as images, and the choice is remembered', async () => {
    const a = boot({ stored: { me } }); await tick(150); await a.go('#/settings'); await tick(100); await pick(a, 'Robots')
    expect(a.mem.get('avatars')).toBe('robots'); await a.go('#/'); await tick(200)
    expect(people(a).length).toBeGreaterThan(0); expect(people(a).every((x) => x.classList.contains('art') && x.querySelector('svg.robot') && x.textContent === '')).toBe(true); expect(a.root.querySelectorAll('img').length).toBe(0)
    await a.go('#/me'); await tick(150); expect(a.root.querySelector('.account .avatar.lg.art svg.robot')).not.toBeNull()
    await a.go('#/settings'); await tick(100); await pick(a, 'Pixels'); expect(a.mem.get('avatars')).toBe('pixels'); await a.go('#/'); await tick(200); expect(people(a).every((x) => x.querySelector('svg.pixel'))).toBe(true)
    const again = boot({ stored: { me, avatars: 'robots' } }); await tick(200); expect(people(again).every((x) => x.querySelector('svg.robot'))).toBe(true)
    await again.go('#/settings'); await tick(100); await pick(again, 'Initials'); expect(again.mem.has('avatars')).toBe(false)
  })
  it('the same account gets the same robot in every card; a stored value that is not a style falls back to initials', async () => {
    const a = boot({ stored: { me, avatars: 'robots' }, events: [...world, ev(friend, 'a second post of my friend', { created_at: 1_800_000_000 })] }); await tick(200)
    const mine = people(a).filter((x) => x.closest('article')!.textContent!.includes('post of my friend') || x.closest('article')!.textContent!.includes('a post from my friend')); expect(mine.length).toBeGreaterThanOrEqual(2)
    expect(new Set(mine.map((x) => x.innerHTML)).size).toBe(1)
    const bad = boot({ stored: { me, avatars: 'photos' } }); await tick(150); expect(people(bad).every((x) => !x.classList.contains('art'))).toBe(true)
  })
})

describe('the Network view in Following', () => {
  const mode = (a: ReturnType<typeof boot>) => a.root.querySelector('.seg.feedmode') as HTMLElement | null
  const btn = (a: ReturnType<typeof boot>, label: string) => [...mode(a)!.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement
  // Ana (friend) follows `far`, who has written a note: that is the network
  const net = [...world.filter((e) => !(e.kind === 3 && e.pubkey === friend)), list(friend, 3, [['p', far]]), ev(far, 'a note from far, followed by my friend', { created_at: 1_900_000_000 })]
  it('has a switch Follows | Network on Following only, with Follows open by default', async () => {
    const a = boot({ events: net, stored: { me } }); await tick(150)
    expect([...mode(a)!.querySelectorAll('button')].map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Follows', 'true'], ['Network', 'false']])
    expect(a.text()).toContain('a post from my friend'); expect(a.text()).not.toContain('a note from far')
    await a.go('#/mentions'); await tick(100); expect(mode(a)).toBeNull(); await a.go('#/me'); await tick(100); expect(mode(a)).toBeNull()
  })
  it('Network shows the notes of the people your follows follow, each saying who follows its author, and not the notes of people you already follow', async () => {
    const a = boot({ events: net, stored: { me } }); await tick(150); btn(a, 'Network').click(); await tick(150)
    expect(btn(a, 'Network').getAttribute('aria-pressed')).toBe('true'); expect(a.text()).toContain('a note from far, followed by my friend'); expect(a.text()).not.toContain('a post from my friend')
    const card = [...a.root.querySelectorAll('article.note')].find((n) => n.textContent!.includes('a note from far'))!; expect(card.querySelector('.reposted')!.textContent).toBe('Followed by Ana'); expect(card.querySelector('.reposted svg')).not.toBeNull()
    expect(a.mem.get('feed')).toBe('network'); btn(a, 'Follows').click(); await tick(150); expect(a.mem.has('feed')).toBe(false); expect(a.text()).toContain('a post from my friend'); expect(a.text()).not.toContain('a note from far')
  })
  it('the choice is remembered, and a stored value that is not a mode falls back to Follows', async () => {
    const a = boot({ events: net, stored: { me, feed: 'network' } }); await tick(200); expect(btn(a, 'Network').getAttribute('aria-pressed')).toBe('true'); expect(a.text()).toContain('a note from far')
    const bad = boot({ events: net, stored: { me, feed: 'everything' } }); await tick(150); expect(btn(bad, 'Follows').getAttribute('aria-pressed')).toBe('true')
  })
  it('the network does not hide everything because of the "outside your network" rule, even with the reach set to follows only', async () => {
    const strict = JSON.stringify({ rules: { repeatedText: true, burst: true, linkOnly: true, outsideNetwork: true }, maxDistance: 1, burstEvents: 5 })
    const a = boot({ events: net, stored: { me, feed: 'network', settings: strict } }); await tick(200)
    expect(a.root.querySelector('details.folded')).toBeNull(); expect(a.text()).toContain('a note from far')
  })
  it('an empty network says why: the lists did not arrive, or there is just nothing new', async () => {
    const noLists = boot({ events: world.filter((e) => !(e.kind === 3 && e.pubkey === friend)), stored: { me, feed: 'network' } }); await tick(200); expect(noLists.text()).toContain('has not loaded yet')
    const nothing = boot({ events: world, stored: { me, feed: 'network' } }); await tick(200); expect(nothing.text()).toContain('Nothing new from the people your follows follow')
  })
})

describe('the loading message takes no room', () => {
  it('hangs under the header, never inside the list, so nothing moves when it comes and goes', async () => {
    const a = boot({ stored: { me }, delayMs: 60 }); await tick(30)
    expect(a.root.querySelector('header.top .status.loading')!.textContent!.length).toBeGreaterThan(5); expect(a.root.querySelector('main.view .status')).toBeNull()
    await tick(1500); expect(a.root.querySelector('.status.loading')).toBeNull(); expect(a.text()).toContain('a post from my friend')
  })
})

describe('the refresh button while loading', () => {
  const refresh = (a: ReturnType<typeof boot>) => a.root.querySelector('header.top button[aria-label="Refresh"]') as HTMLButtonElement
  it('turns (and says it is busy) while the notes load, and stops when they are there', async () => {
    const a = boot({ stored: { me }, delayMs: 60 }); await tick(30)
    expect(refresh(a).classList.contains('spinning')).toBe(true); expect(refresh(a).getAttribute('aria-busy')).toBe('true')
    await tick(1500); expect(a.text()).toContain('a post from my friend'); expect(refresh(a).classList.contains('spinning')).toBe(false); expect(refresh(a).hasAttribute('aria-busy')).toBe(false)
  })
  it('turns again when it is pressed, and still reads everything again', async () => {
    const a = boot({ stored: { me }, delayMs: 40 }); await tick(1200); const before = a.calls.n
    refresh(a).click(); await tick(20); expect(refresh(a).classList.contains('spinning')).toBe(true); await tick(1200); expect(refresh(a).classList.contains('spinning')).toBe(false); expect(a.calls.n).toBeGreaterThan(before)
  })
})

describe('new followers', () => {
  const NOW = 10_000
  const key = (n: number) => ('b' + n.toString(16).padStart(3, '0')).repeat(16) // keys that cannot collide with the fixed ones of this file
  const follower = (n: number, at = 9000) => ev(key(n), '', { kind: 3, created_at: at, tags: [['p', me]] })
  const profile = (who: string, name: string) => ev(who, JSON.stringify({ name }), { kind: 0, created_at: 100 })
  const base = (): Event[] => [list(me, 3, [['p', friend]]), list(friend, 3, []), ev(friend, 'a post from my friend', { created_at: 8000 })]
  const start = (events: Event[], stored: Record<string, string> = {}) => boot({ events, clock: { now: NOW * 1000 }, stored: { me, [`seen:${me}`]: '5000', ...stored } })
  const badge = (a: ReturnType<typeof boot>) => a.root.querySelector('.tabbar .badge')?.textContent ?? null
  const known = (a: ReturnType<typeof boot>) => JSON.parse(a.mem.get(`followers:${me}`) ?? 'null') as string[] | null

  it('the first look only learns who follows you: no number, no list, and the followers are written down', async () => {
    const a = start([...base(), follower(1), follower(2)]); await tick(250)
    expect(badge(a)).toBeNull(); expect(known(a)!.sort()).toEqual([follower(1).pubkey, follower(2).pubkey].sort()); await a.go('#/mentions'); await tick(200); expect(a.root.querySelector('.followers')).toBeNull()
  })
  it('somebody new is a number on Mentions, then a "New followers" card with their name, then part of the known ones', async () => {
    const events = [...base(), follower(1), profile(follower(1).pubkey, 'Ana')]; const a = start(events); await tick(250); expect(badge(a)).toBeNull()
    const newcomer = follower(2); events.push(newcomer, profile(newcomer.pubkey, 'Berta')); a.poll(); await tick(250); expect(badge(a)).toBe('1')
    await a.go('#/mentions'); await tick(250)
    const card = a.root.querySelector('.followers')!; expect(card.querySelector('h2')!.textContent).toBe('New followers (1)'); expect([...card.querySelectorAll('li a > span:not(.avatar)')].map((x) => x.textContent)).toEqual(['Berta']); expect(card.querySelector('li .avatar')).not.toBeNull()
    expect(badge(a)).toBeNull(); expect(known(a)).toContain(newcomer.pubkey)
    await a.go('#/'); await tick(200); await a.go('#/mentions'); await tick(250); expect(a.root.querySelector('.followers')).toBeNull() // seen: not shown again
  })
  it('a relay that does not return somebody today cannot make them look new tomorrow', async () => {
    const events = [...base(), follower(1), follower(2)]; const a = start(events); await tick(250)
    events.splice(events.indexOf(events.find((e) => e.pubkey === follower(2).pubkey)!), 1); a.poll(); await tick(250); expect(badge(a)).toBeNull() // missing now
    events.push(follower(2)); a.poll(); await tick(250); expect(badge(a)).toBeNull() // and back: still not new
  })
  it('opening Mentions while a relay is missing somebody does not forget them: they are still not new when they come back', async () => {
    const events = [...base(), follower(1), follower(2)]; const a = start(events); await tick(250)
    const two = events.find((e) => e.pubkey === follower(2).pubkey)!; events.splice(events.indexOf(two), 1)
    a.poll(); await tick(250) // this look (it asks the relays again) really does miss follower 2
    await a.go('#/mentions'); await tick(250); expect(a.root.querySelector('.followers')).toBeNull(); await a.go('#/'); await tick(200); expect(known(a)).toContain(follower(2).pubkey) // opening Mentions did not forget them
    events.push(two); a.poll(); await tick(250); expect(badge(a)).toBeNull()
  })
  it('muted accounts are not announced; many new ones are listed up to eight with a count of the rest', async () => {
    const events = [...base(), follower(1)]; const a = start(events, { words: '' }); await tick(250)
    for (let i = 10; i < 22; i++) events.push(follower(i)); a.poll(); await tick(250); expect(badge(a)).toBe('9+')
    await a.go('#/mentions'); await tick(300); const card = a.root.querySelector('.followers')!
    expect(card.querySelector('h2')!.textContent).toBe('New followers (12)'); expect(card.querySelectorAll('li').length).toBe(9); expect(card.querySelector('.more-followers')!.textContent).toBe('and 4 more')
  })
  it('a muted follower never shows up', async () => {
    const muteList = ev(me, '', { kind: 10000, created_at: 50, tags: [['p', follower(5).pubkey]] })
    const events = [...base(), muteList, follower(1)]; const a = start(events); await tick(250); events.push(follower(5)); a.poll(); await tick(250); expect(badge(a)).toBeNull()
  })
  it('signing out and in as somebody else carries nothing over', async () => {
    const events = [...base(), follower(1)]; const a = start(events); await tick(250); expect(known(a)).not.toBeNull()
    await a.go('#/me'); await tick(150); ;(a.root.querySelector('button.danger') as HTMLElement).click(); await tick(100)
    const input = a.root.querySelector('input')!; input.value = nip19.npubEncode(friend); a.root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await tick(300)
    expect(a.mem.get(`followers:${friend}`)).toBeDefined(); expect(a.mem.get(`followers:${me}`)).toBeDefined(); expect(badge(a)).toBeNull()
  })
})

describe('reposts of your notes', () => {
  const NOW = 10_000
  const myNote = ev(me, 'a note of mine worth sharing', { created_at: 100 })
  const repost = (who: string, at: number) => ev(who, JSON.stringify(myNote), { kind: 6, created_at: at, tags: [['e', myNote.id], ['p', me]] })
  const base = (): Event[] => [list(me, 3, [['p', friend]]), list(friend, 3, []), ev(friend, JSON.stringify({ name: 'Ana' }), { kind: 0 }), myNote]
  const start = (events: Event[]) => boot({ events, clock: { now: NOW * 1000 }, stored: { me, [`seen:${me}`]: '5000' } })
  const badge = (a: ReturnType<typeof boot>) => a.root.querySelector('.tabbar .badge')?.textContent ?? null
  it('are a number on Mentions and a card that names who shared which of your notes, linking to it', async () => {
    const events = base(); const a = start(events); await tick(250); expect(badge(a)).toBeNull()
    events.push(repost(friend, 9000)); a.poll(); await tick(250); expect(badge(a)).toBe('1')
    await a.go('#/mentions'); await tick(250)
    const card = [...a.root.querySelectorAll('section.reacted')].find((c) => c.querySelector('h2')!.textContent === 'Your notes, reposted')!
    expect(card.querySelector('.what strong')!.textContent).toBe('Ana reposted your note'); expect(card.querySelector('.what q')!.textContent).toContain('a note of mine'); expect(card.querySelector('a')!.getAttribute('href')).toBe(`#/note/${myNote.id}`)
    expect(card.querySelector('a.fresh')).not.toBeNull(); expect(card.querySelector('.emojis svg')).not.toBeNull(); expect(badge(a)).toBeNull()
  })
  it('several people are one line, a stranger\'s repost is counted apart and not listed, and with none there is no card', async () => {
    const none = start(base()); await none.go('#/mentions'); await tick(250); expect([...none.root.querySelectorAll('section.reacted h2')].some((h) => h.textContent === 'Your notes, reposted')).toBe(false)
    const a = start([...base(), repost(friend, 9000), repost(far, 9100)]); await tick(250); await a.go('#/mentions'); await tick(250)
    expect(a.root.querySelector('.new-line')!.textContent).toBe('1 new · hidden by the filter: 1')
    const card = [...a.root.querySelectorAll('section.reacted')].find((c) => c.querySelector('h2')!.textContent === 'Your notes, reposted')!; expect(card.querySelectorAll('li')).toHaveLength(1); expect(card.textContent).not.toContain('Someone')
  })
})

describe('the counts on Me', () => {
  const NOW = 10_000
  const key = (n: number) => ('c' + n.toString(16).padStart(3, '0')).repeat(16)
  const follower = (n: number) => ev(key(n), '', { kind: 3, created_at: 9000, tags: [['p', me]] })
  const base = (): Event[] => [list(me, 3, [['p', friend]]), list(friend, 3, []), ev(friend, 'a post from my friend', { created_at: 8000 })]
  const start = (events: Event[], lang = 'en') => boot({ events, clock: { now: NOW * 1000 }, languages: [lang], stored: { me, lang, [`seen:${me}`]: '5000' } })
  const counts = (a: ReturnType<typeof boot>) => a.root.querySelector('.account .counts')?.textContent ?? null
  it('says how many you follow (exact) and about how many follow you (what the relays showed)', async () => {
    const a = start([...base(), follower(1), follower(2)]); await a.go('#/me'); await tick(300); expect(counts(a)).toBe('1 following · ~2 followers')
    const one = start([...base(), follower(1)]); await one.go('#/me'); await tick(300); expect(counts(one)).toBe('1 following · ~1 follower')
    const none = start(base()); await none.go('#/me'); await tick(300); expect(counts(none)).toBe('1 following · no followers seen yet')
  })
  it('is in the language of the page', async () => {
    const a = start([...base(), follower(1), follower(2)], 'es'); await a.go('#/me'); await tick(300); expect(counts(a)).toBe('1 siguiendo · ~2 seguidores')
    const none = start(base(), 'es'); await none.go('#/me'); await tick(300); expect(counts(none)).toBe('1 siguiendo · ningún seguidor visto aún')
  })
  it('only grows: a new follower is counted before you open Mentions, and one a relay stops returning is not forgotten', async () => {
    const events = [...base(), follower(1), follower(2)]; const a = start(events); await a.go('#/me'); await tick(300); expect(counts(a)).toBe('1 following · ~2 followers')
    events.push(follower(3)); await a.go('#/'); await tick(200); a.poll(); await tick(300); await a.go('#/me'); await tick(300); expect(counts(a)).toBe('1 following · ~3 followers')
    events.splice(events.findIndex((e) => e.pubkey === key(1)), 1); a.poll(); await tick(300); await a.go('#/'); await tick(200); await a.go('#/me'); await tick(300); expect(counts(a)).toBe('1 following · ~3 followers')
  })
  it('does not carry a count over to another account', async () => {
    const events = [...base(), follower(1)]; const a = start(events); await a.go('#/me'); await tick(300); expect(counts(a)).toContain('~1 follower')
    ;(a.root.querySelector('button.danger') as HTMLElement).click(); await tick(100)
    const input = a.root.querySelector('input')!; input.value = nip19.npubEncode(far); a.root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await tick(300)
    await a.go('#/me'); await tick(300); expect(counts(a)).toBe('0 following · no followers seen yet') // `far` follows nobody and nobody follows `far`
  })
})

describe('followers who leave, and stale relays', () => {
  const NOW = 10_000
  const key = (n: number) => ('d' + n.toString(16).padStart(3, '0')).repeat(16)
  const list3 = (n: number, at: number, names = true) => ev(key(n), '', { kind: 3, created_at: at, tags: names ? [['p', me]] : [['p', friend]] })
  const base = (): Event[] => [list(me, 3, [['p', friend]]), list(friend, 3, []), ev(friend, 'a post from my friend', { created_at: 8000 })]
  const clock = { now: NOW * 1000 }
  const start = (events: Event[]) => boot({ events, clock, stored: { me, [`seen:${me}`]: '5000' } })
  const counts = (a: ReturnType<typeof boot>) => a.root.querySelector('.account .counts')?.textContent ?? null
  const badge = (a: ReturnType<typeof boot>) => a.root.querySelector('.tabbar .badge')?.textContent ?? null
  const known = (a: ReturnType<typeof boot>) => JSON.parse(a.mem.get(`followers:${me}`) ?? 'null') as string[]
  const later = (min: number) => { clock.now += min * 60_000 }

  it('the count goes DOWN when somebody stops following you (their newest list no longer names you), once the check is due', async () => {
    clock.now = NOW * 1000; const events = [...base(), list3(1, 9000), list3(2, 9000), list3(3, 9000)]; const a = start(events)
    await a.go('#/me'); await tick(300); expect(counts(a)).toBe('1 following · ~3 followers')
    events.splice(events.findIndex((e) => e.pubkey === key(2) && e.created_at === 9000), 1, list3(2, 9500, false)) // 2 leaves: a newer list without you
    a.poll(); await tick(300); expect(counts(a)).toBe('1 following · ~3 followers') // the check of known followers is not due yet (they are not fetched at every look)
    later(31); a.poll(); await tick(300); expect(counts(a)).toBe('1 following · ~2 followers'); expect(known(a)).not.toContain(key(2)); expect(known(a)).toContain(key(1))
  })
  it('a relay with an old copy of somebody\'s list does not announce a follower who is not one', async () => {
    clock.now = NOW * 1000; const events = [...base(), list3(1, 9000)]; const a = start(events); await tick(300); expect(badge(a)).toBeNull()
    events.push(ev(key(7), '', { kind: 3, created_at: 100, tags: [['p', me]] }), list3(7, 9400, false)) // the stale copy names you; their newest list does not
    a.poll(); await tick(300); expect(badge(a)).toBeNull(); await a.go('#/me'); await tick(300); expect(counts(a)).toBe('1 following · ~1 follower')
  })
  it('somebody who comes back after leaving is announced as new again', async () => {
    clock.now = NOW * 1000; const events = [...base(), list3(1, 9000), list3(2, 9000)]; const a = start(events); await tick(300)
    events.splice(events.findIndex((e) => e.pubkey === key(2) && e.created_at === 9000), 1, list3(2, 9500, false)); later(31); a.poll(); await tick(300); expect(known(a)).not.toContain(key(2))
    events.push(list3(2, 9900, true)); a.poll(); await tick(300); expect(badge(a)).toBe('1') // follows again: new
  })
  it('a known follower a relay does not return is still counted when their newest list names you', async () => {
    clock.now = NOW * 1000; const events = [...base(), list3(1, 9000), list3(2, 9000)]; const a = start(events); await tick(300)
    events.splice(events.findIndex((e) => e.pubkey === key(2) && e.created_at === 9000), 1) // the relay forgot their list entirely
    later(31); a.poll(); await tick(300); await a.go('#/me'); await tick(300); expect(counts(a)).toBe('1 following · ~2 followers') // no list anywhere: not proof of leaving
  })
})

describe('accounts have a page', () => {
  const bio = ev(friend, JSON.stringify({ name: 'Ana', about: 'I write about relays <script>alert(1)</script> and https://ana.example/notes', nip05: 'ana@example.com', website: 'https://ana.example', picture: 'https://evil.example/pic.png' }), { kind: 0, created_at: 50 })
  const folList = ev(friend, '', { kind: 3, created_at: 60, tags: [['p', far], ['p', pk('7')]] })
  const reply = ev(friend, 'a reply by ana', { created_at: 1_800_000_050, tags: [['e', 'e'.repeat(64), '', 'reply']] })
  const events = (): Event[] => [list(me, 3, [['p', friend]]), bio, folList, ev(friend, 'a root note by ana', { created_at: 1_800_000_010 }), reply, ev(far, 'a note by a stranger', { created_at: 1_800_000_020 })]
  const link = (a: ReturnType<typeof boot>, sel: string) => a.root.querySelector(sel) as HTMLAnchorElement

  it('names and avatars in the cards open the account (the avatar link is left out of keyboards and screen readers, the name link says the same)', async () => {
    const a = boot({ events: events(), stored: { me } }); await tick(150)
    const card = [...a.root.querySelectorAll('article.note')].find((n) => n.textContent!.includes('a root note by ana'))!
    expect(card.querySelector('a.name-link')!.getAttribute('href')).toBe(`#/user/${friend}`); expect(card.querySelector('a.avatar-link')!.getAttribute('href')).toBe(`#/user/${friend}`)
    expect(card.querySelector('a.avatar-link')!.getAttribute('aria-hidden')).toBe('true'); expect(card.querySelector('a.avatar-link')!.getAttribute('tabindex')).toBe('-1')
  })
  it('parses #/user/ in hex, npub and nprofile; anything else is not an account page', () => {
    for (const id of [friend, nip19.npubEncode(friend), nip19.nprofileEncode({ pubkey: friend })]) expect(parseRoute(`#/user/${id}`), id.slice(0, 12)).toEqual({ name: 'user', pubkey: friend })
    for (const bad of ['#/user/', '#/user/nonsense', '#/user/' + 'z'.repeat(64), '#/user/nsec1' + 'q'.repeat(58)]) expect(parseRoute(bad), bad).toEqual({ name: 'following' })
  })
  it('shows who it is as text: name, short key, claims, bio, how many it follows, and that you follow it', async () => {
    const a = boot({ events: events(), stored: { me } }); await tick(100); await a.go(`#/user/${friend}`); await tick(250)
    const head = a.root.querySelector('.profile')!; expect(head.querySelector('h2')!.textContent).toBe('Ana'); expect(head.textContent).toContain('ana@example.com'); expect(head.textContent).toContain('https://ana.example')
    expect(head.querySelector('.about')!.textContent).toContain('I write about relays'); expect(head.querySelector('.relation')!.textContent).toBe('You follow this account · Follows 2'); expect(head.querySelector('.avatar.lg')).not.toBeNull()
  })
  it('the bio is only ever text: no markup, no pictures, nothing loaded from what the profile says', async () => {
    const a = boot({ events: events(), stored: { me } }); await tick(100); await a.go(`#/user/${friend}`); await tick(250)
    expect(a.root.querySelector('.profile script')).toBeNull(); expect(a.root.querySelectorAll('img, iframe, object, embed').length).toBe(0); expect(a.root.querySelector('.profile .about')!.textContent).toContain('<script>alert(1)</script>')
    expect(a.root.innerHTML).not.toContain('evil.example')
  })
  it('lists its notes (and only its notes) with Notes | Replies, the replies apart, and says so when there is nothing', async () => {
    const a = boot({ events: events(), stored: { me } }); await tick(100); await a.go(`#/user/${friend}`); await tick(250)
    const seg = () => [...a.root.querySelectorAll('.seg.feedmode button')] as HTMLButtonElement[]
    expect(seg().map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Notes', 'true'], ['Replies', 'false']])
    expect(a.text()).toContain('a root note by ana'); expect(a.text()).not.toContain('a reply by ana'); expect(a.text()).not.toContain('a note by a stranger')
    seg()[1]!.click(); await tick(200); expect(a.text()).toContain('a reply by ana'); expect(a.text()).not.toContain('a root note by ana')
    await a.go(`#/user/${pk('6')}`); await tick(250); expect(a.text()).toContain('Nothing from this account on your relays.')
  })
  it('says how the account relates to you: not followed (and who of yours follows it), muted, or you', async () => {
    const strangerPage = boot({ events: [...events(), list(friend, 3, [['p', far]])], stored: { me } }); await tick(100); await strangerPage.go(`#/user/${far}`); await tick(250)
    expect(strangerPage.root.querySelector('.relation')!.textContent).toBe('You do not follow this account'); expect(strangerPage.text()).toContain('Followed by Ana')
    expect(strangerPage.text()).toContain('a note by a stranger'); expect(strangerPage.root.querySelector('details.folded')).toBeNull() // "outside your network" does not hide an account you opened on purpose
    const mine = boot({ events: events(), stored: { me } }); await tick(100); await mine.go(`#/user/${me}`); await tick(250); expect(mine.root.querySelector('.relation')!.textContent).toContain('This is you')
    const muted = boot({ events: [...events(), ev(me, '', { kind: 10000, created_at: 5, tags: [['p', far]] })], stored: { me } }); await tick(100); await muted.go(`#/user/${far}`); await tick(250); expect(muted.root.querySelector('.relation')!.textContent).toContain('You muted this account')
  })
  it('mentions inside notes open the account, and Back goes where you came from (the history) or to the start', async () => {
    const mention = ev(friend, `hello nostr:${nip19.npubEncode(far)} how are you`, { created_at: 1_800_000_090 })
    const went = { n: 0 }; const a = boot({ events: [...events(), mention], stored: { me }, goBack: () => { went.n++ } }); await tick(150)
    expect(link(a, 'a.ref').getAttribute('href')).toBe(`#/user/${far}`)
    await a.go(`#/user/${friend}`); await tick(250); link(a, '.back').click(); await tick(50); expect(went.n).toBe(1) // uses the history, not a fixed place
    const plain = boot({ events: events(), stored: { me } }); await tick(100); await plain.go(`#/user/${friend}`); await tick(250); link(plain, '.back').click(); await tick(100); expect(plain.root.querySelector('.profile')).toBeNull() // no history: the start
  })
})
