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
const relays = (events: Event[], delayMs = 0, slowFor?: (f: Filter) => number, onlyWhenAll?: (e: Event) => boolean): Fetcher => ({ query: async (f: Filter, o?: { quick?: boolean }) => { const wait = delayMs + (slowFor?.(f) ?? 0); if (wait) await new Promise((r) => setTimeout(r, wait)); return events.filter((e) => answers(f, e) && !(onlyWhenAll?.(e) && o?.quick !== false)) } })
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms))
const roots: HTMLElement[] = []
/** A choice in the search Filters (Show / Search in): its buttons are there even while the panel is folded. */
const pickFilter = (a: { root: HTMLElement }, label: string) => ([...a.root.querySelectorAll('.search-filters button')].find((b) => b.textContent === label) as HTMLButtonElement).click()

function boot(opts: { events?: Event[]; delayMs?: number; stored?: Record<string, string>; languages?: string[]; env?: { ios: boolean; standalone: boolean }; clock?: { now: number }; newer?: { value: boolean }; reachable?: (url: string) => boolean; goBack?: () => void; wide?: { value: boolean }; copy?: (text: string) => void; searchable?: Event[]; onlyWhenAll?: (e: Event) => boolean; slowFor?: (f: Filter) => number; light?: { value: boolean }; elsewhere?: { relay: string; events: Event[]; delayMs: number }; avatarProxy?: string } = {}) {
  const root = document.createElement('div'); document.body.append(root); roots.push(root)
  const location = { hash: '' }, listeners: (() => void)[] = []
  const mem = new Map(Object.entries(opts.stored ?? {})), visible: (() => void)[] = [], ticks: (() => void)[] = [], polls: (() => void)[] = [], wideChanged: (() => void)[] = [], schemeChanged: (() => void)[] = [], reloads = { n: 0 }, asked = { n: 0 }, setRelays: string[][] = [], base = relays(opts.events ?? world, opts.delayMs, opts.slowFor, opts.onlyWhenAll), calls = { n: 0 }, filters: Filter[] = []
  startApp(root, {
    ...(opts.avatarProxy ? { avatarProxy: opts.avatarProxy } : {}),
    fetcher: { query: async (f, o) => { calls.n++; filters.push(f); if (o?.only) { const el = opts.elsewhere; if (!el || !o.only.includes(el.relay)) return []; await new Promise((r) => setTimeout(r, el.delayMs)); return el.events.filter((e) => answers(f, e)) } return base.query(f, o) } }, env: opts.env, goBack: opts.goBack, nowMs: opts.clock ? () => opts.clock!.now : undefined, onVisible: (cb) => visible.push(cb), onTick: (cb) => ticks.push(cb), onPoll: (cb) => polls.push(cb), setRelays: (l) => setRelays.push(l), probeRelay: async (u) => (opts.reachable ?? (() => true))(u), isWide: () => !!opts.wide?.value, verify: (e) => e.content !== 'tampered', prefersLight: () => !!opts.light?.value, onSchemeChange: (cb) => schemeChanged.push(cb), onWide: (cb) => wideChanged.push(cb), reload: () => { reloads.n++ },
    copy: opts.copy,
    searchFetcher: opts.searchable ? { query: async (f: Filter) => opts.searchable!.filter((e) => answers(f, e) && (!(f as { search?: string }).search || e.content.toLowerCase().includes((f as { search: string }).search.toLowerCase()))) } : undefined,
    checkVersion: opts.newer ? async () => { asked.n++; return opts.newer!.value } : undefined, languages: opts.languages ?? ['en'], location, onHash: (cb) => listeners.push(cb), setHash: (h) => { location.hash = h; listeners.forEach((l) => l()) },
    storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) },
  })
  const go = async (hash: string) => { location.hash = hash; listeners.forEach((l) => l()); await tick() }
  return { root, go, mem, calls, filters, wideChanged, schemeChanged, setRelays, reloads, asked, tick: () => ticks.forEach((t) => t()), poll: () => polls.forEach((t) => t()), comeBack: () => visible.forEach((v) => v()), text: () => root.textContent ?? '' }
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
    const en = boot({}); await tick(40); expect(en.root.querySelector('.login .tagline')!.textContent).toBe('Text first. Tells you why it hides things.')
    const es = boot({ languages: ['es'] }); await tick(40); expect(es.root.querySelector('.login .tagline')!.textContent).toBe('Primero el texto. Te dice por qué oculta cosas.')
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
    ;[...a.root.querySelectorAll('button')].find((b) => b.textContent === 'Sign out')!.click(); await tick(10); ;(a.root.querySelector('.confirm-signout button.danger') as HTMLElement).click(); await tick(10) // it asks first
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
    expect(urls(a)).toHaveLength(6); expect(urls(a)).toContain('relay.hivescope.xyz'); expect([...prefs(a).querySelectorAll('.seg:not(.avatars):not(.scheme) button')].map((b) => b.textContent)).toEqual(['Small', 'Normal', 'Large', 'Very large'])
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
    expect(sections(out)).toHaveLength(10); expect(out.text()).toContain('What Quill is'); expect(help(out).getAttribute('aria-pressed')).toBe('true')
    help(out).click(); await tick(60); expect(sections(out)).toHaveLength(0); expect(out.text()).toContain('Read as…')
    const a = boot({ stored: { me } }); await tick(80); expect([...a.root.querySelectorAll('header.top button')].map((b) => b.getAttribute('aria-label') ?? b.textContent).slice(-3)).toEqual(['ES', 'Settings', 'Help'])
  })
  it('opens with the first section unfolded; what you unfold stays unfolded when the page redraws', async () => {
    const a = boot({ stored: { me } }); await tick(80); help(a).click(); await tick(60)
    expect(sections(a).map((s) => s.open)).toEqual([true, false, false, false, false, false, false, false, false, false])
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
  it('every rule, the reposts and the pictures options is a switch (a checkbox announced as on/off), with the words first and the switch at the end, and one line that says what on and off mean', async () => {
    const a = boot({ stored: { me } }); await tick(80); await a.go('#/settings'); await tick(100)
    const rows = [...a.root.querySelectorAll('label.check')]; expect(rows).toHaveLength(11) // six rules + reposts + pictures + the Halloween theme + reading people where they write + real profile pictures
    for (const r of rows) { const input = r.querySelector('input')!; expect(input.type).toBe('checkbox'); expect(input.getAttribute('role')).toBe('switch'); expect(r.firstElementChild!.tagName).toBe('SPAN'); expect(r.lastElementChild).toBe(input) }
    expect(a.root.querySelector('.settings .meta')!.textContent).toBe('On = the rule hides what meets its condition. Off = it hides nothing.')
    const rules = rows.filter((r) => !/Halloween|repost|pictures|where they write|profile pictures/.test(r.textContent!)); expect(rules).toHaveLength(6)
    expect(rules.map((r) => (r.querySelector('input') as HTMLInputElement).checked)).toEqual([true, true, true, true, true, true]) // all on by default
  })
})

describe('avatar style', () => {
  const people = (a: ReturnType<typeof boot>) => [...a.root.querySelectorAll('article.note > .avatar-link > .avatar')] as HTMLElement[]
  const pick = async (a: ReturnType<typeof boot>, label: string) => { const b = [...a.root.querySelectorAll('.seg.avatars button')].find((x) => x.lastChild!.textContent === label) as HTMLElement; b.click(); await tick(150) }
  it('starts with initials; Settings offers initials, robots, pixels and Halloween, each with a sample of the reader\'s own picture', async () => {
    const a = boot({ stored: { me } }); await tick(150)
    expect(people(a).length).toBeGreaterThan(0); expect(people(a).every((x) => !x.classList.contains('art') && /^[A-Z0-9]{2}$/.test(x.textContent!))).toBe(true)
    await a.go('#/settings'); await tick(100); const opts = [...a.root.querySelectorAll('.seg.avatars button')]
    expect(opts.map((b) => b.lastChild!.textContent)).toEqual(['Initials', 'Robots', 'Pixels', 'Halloween']); expect(opts.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false'])
    expect(opts[1]!.querySelector('.avatar.art svg.robot')).not.toBeNull(); expect(opts[2]!.querySelector('.avatar.art svg.pixel')).not.toBeNull(); expect(opts[3]!.querySelector('.avatar.art svg.spooky')).not.toBeNull(); expect(opts[0]!.querySelector('.avatar')!.classList.contains('art')).toBe(false)
  })
  it('robots and pixels replace the initials everywhere (cards and the account), as page elements and never as images, and the choice is remembered', async () => {
    const a = boot({ stored: { me } }); await tick(150); await a.go('#/settings'); await tick(100); await pick(a, 'Robots')
    expect(a.mem.get('avatars')).toBe('robots'); await a.go('#/'); await tick(200)
    expect(people(a).length).toBeGreaterThan(0); expect(people(a).every((x) => x.classList.contains('art') && x.querySelector('svg.robot') && x.textContent === '')).toBe(true); expect(a.root.querySelectorAll('img').length).toBe(0)
    await a.go('#/me'); await tick(150); expect(a.root.querySelector('.account .avatar.lg.art svg.robot')).not.toBeNull()
    await a.go('#/settings'); await tick(100); await pick(a, 'Pixels'); expect(a.mem.get('avatars')).toBe('pixels'); await a.go('#/'); await tick(200); expect(people(a).every((x) => x.querySelector('svg.pixel'))).toBe(true)
    await a.go('#/settings'); await tick(100); await pick(a, 'Halloween'); expect(a.mem.get('avatars')).toBe('halloween'); await a.go('#/'); await tick(200); expect(people(a).every((x) => x.querySelector('svg.spooky') && x.textContent === '')).toBe(true); expect(a.root.querySelectorAll('img').length).toBe(0)
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
    expect([...mode(a)!.querySelectorAll('button')].map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Follows', 'true'], ['Network', 'false'], ['Popular', 'false'], ['Highlights', 'false']])
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
    const strict = JSON.stringify({ rules: { repeatedText: true, burst: true, linkOnly: true, mentionFlood: true, notText: true, outsideNetwork: true }, maxDistance: 1, burstEvents: 5 })
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
    await a.go('#/me'); await tick(150); ;(a.root.querySelector('button.danger') as HTMLElement).click(); await tick(20); ;(a.root.querySelector('.confirm-signout button.danger') as HTMLElement).click(); await tick(100)
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
    ;(a.root.querySelector('button.danger') as HTMLElement).click(); await tick(20); ;(a.root.querySelector('.confirm-signout button.danger') as HTMLElement).click(); await tick(100)
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

describe('a note opened by someone with no account', () => {
  const root = ev(friend, 'the note someone shared'), reply = ev(far, 'a pitch from a stranger, a reply nobody filtered', { tags: [['e', root.id, '', 'root'], ['e', root.id, '', 'reply']] })
  const dupes = [1, 2, 3, 4, 5, 6].map((i) => ev(pk('9'), 'buy my thing now https://spam.example/x', { tags: [['e', root.id, '', 'root'], ['e', root.id, '', 'reply']], created_at: 1_700_000_000 + i }))
  const named = ev(friend, '', { kind: 0, content: JSON.stringify({ name: 'Ana' }) })
  it('shows the note and its replies exactly as they are (nothing folded, no tabs), with the login below and a hint', async () => {
    const a = boot({ events: [root, reply, ...dupes, named] }); await a.go('#/note/' + root.id); await tick(60)
    expect(a.text()).toContain('the note someone shared'); expect(a.text()).toContain('a reply nobody filtered'); expect(a.text()).toContain('Ana')
    expect(a.root.querySelectorAll('details.folded')).toHaveLength(0); expect(a.root.querySelector('.tabbar')).toBeNull()
    expect(a.root.querySelectorAll('article.note').length).toBe(2 + dupes.length) // the spammy burst is shown too: a guest has no filter
    expect(a.text()).toContain('without an account'); expect(a.text()).toContain('Read as…') // the way in is right under the note
    expect(a.mem.get('me')).toBeUndefined()
  })
  it('a nevent link works the same, a note that cannot be found says so, and choosing an account afterwards keeps the note', async () => {
    const link = '#/note/' + nip19.neventEncode({ id: root.id, author: friend, relays: ['wss://x.example'], kind: 1 })
    const a = boot({ events: [root, reply, list(me, 3, [['p', friend]]), named] }); await a.go(link); await tick(60)
    expect(a.text()).toContain('the note someone shared')
    await a.go('#/note/' + 'e'.repeat(64)); await tick(60); expect(a.text()).toContain('Could not find that note')
    await a.go(link); await tick(60)
    const input = a.root.querySelector('input[type=text]') as HTMLInputElement; input.value = nip19.npubEncode(me); a.root.querySelector('form.login')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); await tick(120)
    expect(a.root.querySelector('.tabbar')).not.toBeNull(); expect(a.text()).toContain('the note someone shared'); expect(a.text()).not.toContain('without an account')
  })
})

describe('the lists behind the counts in Me', () => {
  const NOW = 10_000
  const key = (n: number) => ('c' + n.toString(16).padStart(3, '0')).repeat(16)
  const fol = (n: number, at = 9000) => ev(key(n), '', { kind: 3, created_at: at, tags: [['p', me]] })
  const named = (who: string, name: string) => ev(who, JSON.stringify({ name }), { kind: 0, created_at: 100 })
  const events = (): Event[] => [list(me, 3, [['p', friend], ['p', key(9)]]), list(friend, 3, [['p', me]]), fol(1), fol(2), named(friend, 'Ana'), named(key(9), 'Nina'), named(key(1), 'Uno'), named(key(2), 'Dos')]
  const start = (evs: Event[]) => boot({ events: evs, clock: { now: NOW * 1000 }, stored: { me, [`seen:${me}`]: '5000' } })
  const rows = (a: ReturnType<typeof boot>) => [...a.root.querySelectorAll('.people li')].map((li) => [li.querySelector('strong')!.textContent, li.querySelector('.tag')?.textContent ?? null])

  it('the counts in Me are links, one to each list', async () => {
    const a = start(events()); await tick(80); await a.go('#/me'); await tick(80)
    const links = [...a.root.querySelectorAll('.counts a')]; expect(links.map((l) => l.getAttribute('href'))).toEqual(['#/me/following', '#/me/followers']); expect(links[0]!.textContent).toBe('2 following')
  })
  it('Following is your own list, newest first, and marks who follows you back; a tap on a row opens that account', async () => {
    const a = start(events()); await tick(80); await a.go('#/me/following'); await tick(120)
    expect(a.root.querySelector('.people-page h2')!.textContent).toBe('Following (2)'); expect(rows(a)).toEqual([['Nina', null], ['Ana', 'follows you']])
    expect((a.root.querySelector('.people a.person') as HTMLAnchorElement).getAttribute('href')).toBe(`#/user/${key(9)}`)
    expect(a.root.querySelector('.tabbar')).not.toBeNull()
  })
  it('Followers are the ones this app has seen (so the count is approximate), and marks the ones you follow', async () => {
    const a = start(events()); await tick(80); await a.go('#/me/followers'); await tick(250)
    expect(a.root.querySelector('.people-page h2')!.textContent).toMatch(/^Followers \(~3\)$/); expect(a.text()).toContain('no official list')
    expect(rows(a).map((r) => r[0]).sort()).toEqual(['Ana', 'Dos', 'Uno']); expect(rows(a).find((r) => r[0] === 'Ana')![1]).toBe('you follow'); expect(rows(a).find((r) => r[0] === 'Uno')![1]).toBeNull()
  })
  it('a long list comes in tandas of 30 with a button, and the names of each tanda are asked for when it is opened', async () => {
    const many = Array.from({ length: 70 }, (_, i) => ['p', key(100 + i)])
    const a = start([list(me, 3, many), ...Array.from({ length: 70 }, (_, i) => named(key(100 + i), `Persona ${i}`))]); await tick(80); await a.go('#/me/following'); await tick(200)
    expect(a.root.querySelectorAll('.people li')).toHaveLength(30); expect(rows(a)[0]![0]).toBe('Persona 69') // newest (last in the list) first
    const more = () => a.root.querySelector('.people-page button.more') as HTMLButtonElement
    expect(more().textContent).toContain('40'); more().click(); await tick(150); expect(a.root.querySelectorAll('.people li')).toHaveLength(60)
    more().click(); await tick(150); expect(a.root.querySelectorAll('.people li')).toHaveLength(70); expect(more()).toBeNull(); expect(rows(a)[69]![0]).toBe('Persona 0')
  })
  it('an empty list says so', async () => {
    const a = start([list(me, 3, [])]); await tick(80); await a.go('#/me/following'); await tick(120); expect(a.text()).toContain('Nobody here yet.')
  })
})

describe('the bottom bar steps aside while you read down', () => {
  const many = (): Event[] => [list(me, 3, [['p', friend]]), list(friend, 3, []), ...Array.from({ length: 40 }, (_, i) => ev(friend, `post number ${i} from my friend, with enough words`, { created_at: 8000 + i }))]
  const scrollTo = async (a: ReturnType<typeof boot>, top: number) => { const m = a.root.querySelector('main.view') as HTMLElement; m.scrollTop = top; m.dispatchEvent(new Event('scroll')); await tick(10) }
  const hidden = (a: ReturnType<typeof boot>) => a.root.classList.contains('bars-hidden')
  it('hides after a real scroll down, comes back on a scroll up or near the top, and small moves do nothing', async () => {
    const a = boot({ events: many(), stored: { me } }); await tick(150)
    expect(hidden(a)).toBe(false)
    await scrollTo(a, 60); expect(hidden(a)).toBe(false) // too close to the top
    await scrollTo(a, 130); expect(hidden(a)).toBe(true)
    await scrollTo(a, 135); expect(hidden(a)).toBe(true) // a small move changes nothing
    await scrollTo(a, 100); expect(hidden(a)).toBe(false) // up: back
    await scrollTo(a, 400); expect(hidden(a)).toBe(true)
    await scrollTo(a, 20); expect(hidden(a)).toBe(false) // near the top: back
  })
  it('stays hidden through a redraw while reading, and a new view brings the bar back', async () => {
    const a = boot({ events: many(), stored: { me } }); await tick(150)
    await scrollTo(a, 300); expect(hidden(a)).toBe(true)
    await a.go(''); await tick(80); expect(hidden(a)).toBe(true) // the page was loaded and redrawn, the bar did not jump back
    await a.go('#/mentions'); await tick(100); expect(hidden(a)).toBe(false)
  })
})


describe('wide screens: three columns and a panel', () => {
  const wideWorld = (): Event[] => [...world, ev(friend, 'a second post from my friend', { created_at: 8100 })]
  const col = (a: ReturnType<typeof boot>, id: string) => a.root.querySelector(`.col[data-col="${id}"]`) as HTMLElement
  const titles = (a: ReturnType<typeof boot>) => [...a.root.querySelectorAll('.col > .col-title > span')].map((x) => x.textContent)
  it('shows Following, Mentions and Me side by side, each with its own content, and no tab bar', async () => {
    const a = boot({ events: wideWorld(), stored: { me }, wide: { value: true } }); await tick(250)
    expect(titles(a)).toEqual(['Following', 'Mentions', 'Me']); expect(a.root.querySelector('.tabbar')).toBeNull(); expect(a.root.classList.contains('wide')).toBe(true)
    expect(col(a, 'following').textContent).toContain('a post from my friend')
    expect(col(a, 'mentions').textContent).toContain('a pitch from a stranger')
    expect(col(a, 'me').querySelector('.account')).not.toBeNull(); expect(col(a, 'me').textContent).toContain('My notes')
    expect(a.root.querySelector('.col.detail')).toBeNull()
  })
  it('the refresh button turns while the columns load and stops when they are done', async () => {
    const a = boot({ events: wideWorld(), stored: { me }, wide: { value: true }, delayMs: 30 }); await tick(10)
    const spinning = () => a.root.querySelector('button.icon.spinning') !== null
    expect(spinning()).toBe(true) // loading
    await tick(700); expect(col(a, 'following').textContent).toContain('a post from my friend'); expect(spinning()).toBe(false)
    await a.go('#/me/following'); await tick(400); expect(spinning()).toBe(false) // the panel loaded too
  })
  it('a thread opens in a panel on the right and the columns stay exactly as they were (not loaded again)', async () => {
    const post = wideWorld().find((e) => e.content === 'a post from my friend')!
    const a = boot({ events: wideWorld(), stored: { me }, wide: { value: true } }); await tick(250)
    const first = col(a, 'following').querySelector('article.note')!; const calls = a.calls.n
    await a.go('#/note/' + post.id); await tick(150)
    expect(titles(a)).toEqual(['Following', 'Mentions', 'Me', 'Thread']); expect(col(a, 'detail').textContent).toContain('a post from my friend')
    expect(col(a, 'following').querySelector('article.note')).toBe(first) // the very same card: nothing was rebuilt
    expect(a.calls.n - calls).toBeLessThan(8) // only the thread was asked for
    ;(col(a, 'detail').querySelector('button.close') as HTMLElement).click(); await tick(60)
    expect(a.root.querySelector('.col.detail')).toBeNull(); expect(col(a, 'following').querySelector('article.note')).toBe(first)
  })
  it('an account and the lists open in the panel too; Settings and Help take the whole page', async () => {
    const a = boot({ events: wideWorld(), stored: { me }, wide: { value: true } }); await tick(250)
    await a.go('#/user/' + friend); await tick(150); expect(col(a, 'detail').textContent).toContain('Ana')
    await a.go('#/me/following'); await tick(150); expect(titles(a).at(-1)).toBe('Following'); expect(col(a, 'detail').querySelector('.people')).not.toBeNull()
    await a.go('#/settings'); await tick(80); expect(a.root.querySelector('.col')).toBeNull(); expect(a.root.querySelector('main.view.wide')).toBeNull()
    await a.go('#/help'); await tick(80); expect(a.root.querySelector('.col')).toBeNull(); expect(a.text()).toContain('What Quill is')
  })
  it('each column keeps its own place when the page is redrawn', async () => {
    const a = boot({ events: wideWorld(), stored: { me }, wide: { value: true } }); await tick(250)
    col(a, 'following').scrollTop = 120; col(a, 'mentions').scrollTop = 40
    await a.go('#/me/following'); await tick(150)
    expect(col(a, 'following').scrollTop).toBe(120); expect(col(a, 'mentions').scrollTop).toBe(40)
  })
  it('narrowing the window brings the single column and the tab bar back, and widening it again the three columns', async () => {
    const w = { value: true }; const a = boot({ events: wideWorld(), stored: { me }, wide: w }); await tick(250)
    w.value = false; a.wideChanged.forEach((cb) => cb()); await tick(200)
    expect(a.root.querySelector('.col')).toBeNull(); expect(a.root.querySelector('.tabbar')).not.toBeNull(); expect(a.text()).toContain('a post from my friend')
    w.value = true; a.wideChanged.forEach((cb) => cb()); await tick(250)
    expect(titles(a)).toEqual(['Following', 'Mentions', 'Me']); expect(a.root.querySelector('.tabbar')).toBeNull()
  })
  it('Settings and Help keep the header where it is on a wide screen (the screen is wide even when the page is one column)', async () => {
    const a = boot({ events: wideWorld(), stored: { me }, wide: { value: true } }); await tick(250)
    expect(a.root.classList.contains('wide')).toBe(true); expect(a.root.classList.contains('wide-screen')).toBe(true)
    for (const page of ['#/settings', '#/help']) { await a.go(page); await tick(80); expect(a.root.classList.contains('wide'), page).toBe(false); expect(a.root.classList.contains('wide-screen'), page).toBe(true) }
  })
  it('a change made in Settings (avatars, filter) is already in the columns when you go back, without reloading the page', async () => {
    const a = boot({ events: wideWorld(), stored: { me }, wide: { value: true } }); await tick(250)
    const avatars = () => [...col(a, 'following').querySelectorAll('article.note .avatar')]
    expect(avatars().length).toBeGreaterThan(0); expect(avatars().every((x) => !x.classList.contains('art'))).toBe(true)
    await a.go('#/settings'); await tick(100)
    ;([...a.root.querySelectorAll('.seg.avatars button')].find((b) => b.textContent!.includes('Robots')) as HTMLElement).click(); await tick(250)
    await a.go('#/'); await tick(150)
    expect(avatars().every((x) => x.classList.contains('art') && x.querySelector('svg.robot'))).toBe(true)
    expect(col(a, 'mentions').querySelector('.avatar.art svg.robot')).not.toBeNull(); expect(col(a, 'me').querySelector('.account .avatar.lg.art svg.robot')).not.toBeNull()
  })
  it('narrow screens are unchanged: one column and the tab bar', async () => {
    const a = boot({ events: wideWorld(), stored: { me }, wide: { value: false } }); await tick(250)
    expect(a.root.querySelector('.col')).toBeNull(); expect(a.root.querySelector('.tabbar')).not.toBeNull(); expect(a.root.classList.contains('wide')).toBe(false); expect(a.root.classList.contains('wide-screen')).toBe(false)
  })
})


describe('the Halloween theme', () => {
  const IN = new Date(2026, 9, 28, 12).getTime(), OUT = new Date(2026, 2, 3, 12).getTime()
  const themed = (a: ReturnType<typeof boot>) => document.documentElement.getAttribute('data-theme') === 'halloween'
  it('is off outside the season: no cobweb, no pumpkin, the normal wording', async () => {
    const a = boot({ stored: { me }, clock: { now: OUT } }); await tick(150)
    expect(themed(a)).toBe(false); expect(a.root.querySelector('.cobweb')).toBeNull(); expect(a.root.querySelector('.pumpkin')).toBeNull(); expect(a.root.querySelector('.wordmark svg.logo path')!.getAttribute('fill')).toBe('#2dd4bf')
  })
  it('turns itself on in the season: colours, a pumpkin and a cobweb in the header, an orange quill, and the spooky wording', async () => {
    const a = boot({ events: [list(me, 3, [])], stored: { me }, clock: { now: IN } }); await tick(200)
    expect(themed(a)).toBe(true); expect(a.root.querySelector('.top .cobweb svg')).not.toBeNull(); expect(a.root.querySelector('.wordmark .pumpkin')).not.toBeNull()
    expect(a.root.querySelector('.wordmark svg.logo path')!.getAttribute('fill')).toBe('#ff8a1f'); expect(a.text()).toContain('Nothing here but dust and cobwebs.')
  })
  it('what the reader chose wins: switched off in the season it stays off (and the choice is kept); switched on out of the season it stays on', async () => {
    const off = boot({ stored: { me, theme: 'default' }, clock: { now: IN } }); await tick(150); expect(themed(off)).toBe(false); expect(off.root.querySelector('.cobweb')).toBeNull()
    const on = boot({ stored: { me, theme: 'halloween' }, clock: { now: OUT } }); await tick(150); expect(themed(on)).toBe(true); expect(on.root.querySelector('.cobweb')).not.toBeNull()
  })
  it('Settings has the switch: it follows the season, a tap is an explicit choice that is remembered, and it changes the page at once', async () => {
    const a = boot({ stored: { me }, clock: { now: OUT } }); await tick(150); await a.go('#/settings'); await tick(100)
    const sw = () => [...a.root.querySelectorAll('label.check')].find((l) => l.textContent!.includes('Halloween theme'))!.querySelector('input') as HTMLInputElement
    expect(sw().checked).toBe(false); sw().checked = true; sw().dispatchEvent(new Event('change', { bubbles: true })); await tick(60)
    expect(a.mem.get('theme')).toBe('halloween'); expect(themed(a)).toBe(true); expect(a.root.querySelector('.cobweb')).not.toBeNull(); expect(sw().checked).toBe(true)
    sw().checked = false; sw().dispatchEvent(new Event('change', { bubbles: true })); await tick(60)
    expect(a.mem.get('theme')).toBe('default'); expect(themed(a)).toBe(false); expect(a.root.querySelector('.cobweb')).toBeNull()
    expect(a.text()).toContain('It turns on by itself from 24 October to 1 November')
  })
})


describe('the first screen does not wait for the follow graph', () => {
  const graphQuery = (f: Filter) => f.kinds?.length === 1 && f.kinds[0] === 3 && !!f.authors && f.limit === 200 // the follow lists of the people you follow
  const slow = { slowFor: (f: Filter) => (graphQuery(f) ? 1500 : 0) }
  it('the Following feed is on the page while the graph is still on its way, and is built again when it arrives', async () => {
    const a = boot({ stored: { me }, ...slow }); await tick(500)
    expect(a.text()).toContain('a post from my friend') // the graph needs 1500 ms: the feed did not wait for it
    await tick(1600); expect(a.text()).toContain('a post from my friend') // and after the graph arrived it is still there (built once more, from what was already asked)
  })
  it('Mentions, which judge by the graph, wait for it: nothing is shown with a half-known graph', async () => {
    const a = boot({ stored: { me }, ...slow }); await tick(200); await a.go('#/mentions'); await tick(400)
    expect(a.text()).not.toContain('a pitch from a stranger') // not yet: the graph decides whether it is outside the network
    await tick(1800); expect(a.text()).toContain('a pitch from a stranger')
  })
})

describe('what each of my notes got, shown in Me', () => {
  const mineA = ev(me, 'my first note', { created_at: 7000 }), mineB = ev(me, 'a note nobody noticed', { created_at: 6000 })
  const events = (): Event[] => [list(me, 3, [['p', friend]]), list(friend, 3, []), mineA, mineB,
    ev(friend, '❤️', { kind: 7, tags: [['e', mineA.id], ['p', me]] }), ev(far, '+', { kind: 7, tags: [['e', mineA.id], ['p', me]] }), ev(pk('9'), '❤', { kind: 7, tags: [['e', mineA.id], ['p', me]] }),
    ev(friend, '', { kind: 6, tags: [['e', mineA.id], ['p', me]] }), ev(far, 'a reply', { tags: [['e', mineA.id, '', 'reply'], ['p', me]] }),
    ev(me, '🔥', { kind: 7, tags: [['e', mineA.id], ['p', me]] })] // the reader's own reaction does not count
  const reachOfNote = (a: ReturnType<typeof boot>, text: string) => ([...a.root.querySelectorAll('article.note')].find((n) => n.textContent!.includes(text))?.querySelector('.reach') as HTMLElement | null)
  it('under each note of mine that got something: the reactions with their number, the reposts and the replies; nothing under one that got nothing', async () => {
    const a = boot({ events: events(), stored: { me } }); await tick(150); await a.go('#/me'); await tick(500)
    const r = reachOfNote(a, 'my first note')!; expect(r).not.toBeNull()
    expect(r.textContent!.replace(/\s+/g, ' ').trim()).toBe('❤ 2👍 1 1 1') // two hearts, a thumb; one repost and one reply (the icons have no text; the gap between them is CSS)
    expect(r.querySelectorAll('svg')).toHaveLength(2); expect(r.getAttribute('aria-label')).toBe('3 reactions, 1 repost, 1 reply')
    expect(reachOfNote(a, 'a note nobody noticed')).toBeNull()
  })
  it('a tap on the numbers shows who: the people of each emoji and the reposters, each a link to the account, and the replies lead to the conversation', async () => {
    const a = boot({ events: [...events(), ev(friend, JSON.stringify({ name: 'Ana' }), { kind: 0 })], stored: { me } }); await tick(150); await a.go('#/me'); await tick(500)
    const r = reachOfNote(a, 'my first note')!; const box = r.parentElement!, panel = box.querySelector('.reach-who') as HTMLElement
    expect(panel.hidden).toBe(true); r.click(); expect(panel.hidden).toBe(false); expect(r.getAttribute('aria-expanded')).toBe('true')
    const rows = [...panel.querySelectorAll('p')].map((p) => p.textContent!.replace(/\s+/g, ' ').trim())
    expect(rows[0]).toMatch(/^❤ ?Ana, /); expect(rows).toContain(rows.find((x) => x.startsWith('👍'))!); expect(rows.some((x) => x.includes('Ana') && !x.startsWith('❤'))).toBe(true) // Ana also reposted
    expect([...panel.querySelectorAll('a')].some((l) => l.getAttribute('href') === `#/user/${friend}`)).toBe(true)
    expect([...panel.querySelectorAll('a')].find((l) => l.textContent === '1 reply')!.getAttribute('href')).toBe(`#/note/${mineA.id}`)
    r.click(); expect(panel.hidden).toBe(true)
  })
  it('works in the Me column of a wide screen too, and the numbers are asked for only once', async () => {
    const a = boot({ events: events(), stored: { me }, wide: { value: true } }); await tick(700)
    expect(a.root.querySelector('.col[data-col="me"] .reach')).not.toBeNull()
    const calls = a.calls.n; await tick(600); expect(a.calls.n).toBe(calls) // nothing is asked again while you look
  })
})

describe('the feed from last time is shown at once', () => {
  it('opening again shows the last Following feed before the relays answer, then the fresh one replaces it', async () => {
    const first = boot({ stored: { me } }); await tick(300)
    const saved = Object.fromEntries(first.mem); expect(saved[`feedcache:${me}`]).toBeTruthy()
    const again = boot({ stored: saved, delayMs: 1500 }); await tick(100)
    expect(again.text()).toContain('a post from my friend') // the relays have not answered yet
    await tick(2500); expect(again.text()).toContain('a post from my friend')
  })
  it('a note whose signature does not check out is not shown from the saved copy, and signing out deletes it', async () => {
    const first = boot({ stored: { me } }); await tick(300)
    const saved = Object.fromEntries(first.mem); const c = JSON.parse(saved[`feedcache:${me}`]!); c.items[0].event.content = 'tampered'; saved[`feedcache:${me}`] = JSON.stringify(c)
    const again = boot({ stored: saved, delayMs: 1500 }); await tick(100); expect(again.text()).not.toContain('tampered')
    await tick(2500); await again.go('#/me'); await tick(150)
    ;[...again.root.querySelectorAll('button')].find((b) => b.textContent === 'Sign out')!.click(); await tick(20); ;(again.root.querySelector('.confirm-signout button.danger') as HTMLElement).click(); await tick(20)
    expect(again.mem.has(`feedcache:${me}`)).toBe(false)
  })
})


describe('the look once a minute asks only for what is new', () => {
  it('after the first look it asks with "since" (the last visit to Mentions, with a margin), and a new mention still makes the number', async () => {
    const NOW = 10_000
    const events: Event[] = [list(me, 3, [['p', friend]]), list(friend, 3, []), ev(friend, 'old post', { created_at: 4000 }), ev(friend, '', { kind: 3, created_at: 3000, tags: [['p', me]] })]
    const a = boot({ events, clock: { now: NOW * 1000 }, stored: { me, [`seen:${me}`]: '5000', [`followers:${me}`]: JSON.stringify([friend]) } }); await tick(300)
    a.filters.length = 0; a.poll(); await tick(200)
    const mentionQueries = a.filters.filter((f) => (f as Record<string, unknown>)['#p'])
    expect(mentionQueries.length).toBeGreaterThan(0)
    // the first look of this page checks every known follower (a full look); the next one is incremental
    a.filters.length = 0; a.poll(); await tick(200)
    const next = a.filters.filter((f) => (f as Record<string, unknown>)['#p'])
    expect(next.length).toBe(4); expect(next.every((f) => f.since === 5000 - 120)).toBe(true)
    events.push(ev(friend, 'hello, a new mention', { created_at: 9000, tags: [['p', me]] })); a.poll(); await tick(200)
    expect(a.root.querySelector('.tabbar .badge')?.textContent).toBe('1')
  })
})


describe('light and dark', () => {
  const scheme = () => document.documentElement.getAttribute('data-scheme')
  const pick = async (a: ReturnType<typeof boot>, label: string) => { await a.go('#/settings'); await tick(80); ([...a.root.querySelectorAll('.seg.scheme button')].find((b) => b.textContent === label) as HTMLElement).click(); await tick(40) }
  it('is dark by default; Light is chosen in Settings and remembered; Dark goes back', async () => {
    const a = boot({ stored: { me } }); await tick(100); expect(scheme()).toBeNull()
    await pick(a, 'Light'); expect(scheme()).toBe('light'); expect(a.mem.get('scheme')).toBe('light')
    expect([...a.root.querySelectorAll('.seg.scheme button')].map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false'])
    await pick(a, 'Dark'); expect(scheme()).toBeNull(); expect(a.mem.has('scheme')).toBe(false)
    const again = boot({ stored: { me, scheme: 'light' } }); await tick(100); expect(scheme()).toBe('light')
  })
  it('Automatic follows the system, also when the system changes', async () => {
    const light = { value: false }; const a = boot({ stored: { me, scheme: 'auto' }, light }); await tick(100); expect(scheme()).toBeNull()
    light.value = true; a.schemeChanged.forEach((cb) => cb()); expect(scheme()).toBe('light')
    light.value = false; a.schemeChanged.forEach((cb) => cb()); expect(scheme()).toBeNull()
  })
  it('the Halloween theme stays dark even with Light chosen, and says so in Settings', async () => {
    const a = boot({ stored: { me, scheme: 'light', theme: 'halloween' } }); await tick(100); expect(scheme()).toBeNull()
    await a.go('#/settings'); await tick(80); expect(a.text()).toContain('While the Halloween theme is on, Quill stays dark.')
  })
})

describe('a quoted note is shown inside the note that quotes it', () => {
  it('once it is known it replaces the "Quoted note" button: its author and text, a link to it; a hidden one shows only why', async () => {
    const quoted = ev(friend, 'the note being quoted', { created_at: 7000 }), spam = ev(far, 'buy cheap stuff https://spam.example/x', { created_at: 7100 })
    const quoting = ev(friend, `look at this nostr:${nip19.noteEncode(quoted.id)}`, { created_at: 8000 }), quotingSpam = ev(friend, `and this nostr:${nip19.noteEncode(spam.id)}`, { created_at: 8100 })
    const missing = ev(friend, `and a lost one nostr:${nip19.noteEncode('e'.repeat(64))}`, { created_at: 8200 })
    const a = boot({ events: [...world, quoted, spam, quoting, quotingSpam, missing, ev(friend, JSON.stringify({ name: 'Ana' }), { kind: 0 })], stored: { me } }); await tick(800)
    const card = (text: string) => [...a.root.querySelectorAll('article.note')].find((n) => n.querySelector('.body')!.textContent!.startsWith(text))!
    const q = card('look at this').querySelector('a.quote') as HTMLAnchorElement
    expect(q).not.toBeNull(); expect(q.textContent).toContain('the note being quoted'); expect(q.textContent).toContain('Ana'); expect(q.getAttribute('href')).toBe(`#/note/${quoted.id}?from=${quoting.id}`)
    const hidden = card('and this').querySelector('a.quote')!; expect(hidden.querySelector('.quote-hidden')).not.toBeNull(); expect(hidden.textContent).not.toContain('buy cheap stuff')
    expect(card('and a lost one').querySelector('a.quote')).toBeNull(); expect(card('and a lost one').querySelector('.body a.thread-link')!.textContent).toContain('Quoted note') // no relay has it: the button stays
  })
})

describe('pictures linked in a note', () => {
  it('wait for a tap on a button naming their site; tapped, the picture loads without a referrer and a tap on it opens it whole, not the thread', async () => {
    const a = boot({ events: [...world, ev(friend, 'my desk https://m.primal.net/abc.jpg and a page https://example.com/x.html', { created_at: 8000 })], stored: { me } }); await tick(800)
    const card = [...a.root.querySelectorAll('article.note')].find((n) => n.textContent!.includes('my desk'))!
    expect(card.querySelector('img')).toBeNull(); expect(card.querySelector('a.ext')!.getAttribute('href')).toBe('https://example.com/x.html')
    const btn = card.querySelector('button.pic-btn') as HTMLButtonElement; expect(btn.textContent).toContain('Show image · m.primal.net')
    btn.click(); await tick(50)
    const img = card.querySelector('.pic img')!; expect(img.getAttribute('src')).toBe('https://m.primal.net/abc.jpg'); expect(img.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(card.querySelector('.pic a.pic-open')!.getAttribute('target')).toBe('_blank'); expect(card.querySelector('.pic-host')!.textContent).toBe('m.primal.net')
    expect(location.hash).not.toContain('#/note/')
  })
  it('with the setting on, load by themselves only from people the reader follows', async () => {
    const a = boot({ events: [...world, ev(friend, 'friend pic https://image.nostr.build/a.png', { created_at: 8000 }), ev(far, 'stranger pic https://image.nostr.build/b.png', { created_at: 8100 })], stored: { me, autoImages: '1' } }); await tick(800)
    const card = (text: string) => [...a.root.querySelectorAll('article.note')].find((n) => n.textContent!.includes(text))
    expect(card('friend pic')!.querySelector('.pic img')).not.toBeNull()
    const stranger = card('stranger pic'); if (stranger) { expect(stranger.querySelector('.pic img')).toBeNull(); expect(stranger.querySelector('button.pic-btn')).not.toBeNull() }
  })
})

describe('videos linked in a note', () => {
  it('wait for a tap on "Show video · site" (even with pictures loading by themselves), then play inline from that site; a video page stays a link', async () => {
    const a = boot({ events: [...world, ev(friend, 'clip https://v.nostr.build/c.mp4 and https://www.youtube.com/watch?v=x', { created_at: 8000 })], stored: { me, autoImages: '1' } }); await tick(800)
    const card = [...a.root.querySelectorAll('article.note')].find((n) => n.textContent!.includes('clip'))!
    expect(card.querySelector('video')).toBeNull(); expect(card.querySelector('a.ext')!.getAttribute('href')).toContain('youtube.com')
    const btn = card.querySelector('button.pic-btn') as HTMLButtonElement; expect(btn.textContent).toContain('Show video · v.nostr.build')
    btn.click(); await tick(50)
    const vid = card.querySelector('.pic video')!; expect(vid.getAttribute('src')).toBe('https://v.nostr.build/c.mp4'); expect(vid.hasAttribute('controls')).toBe(true); expect(vid.hasAttribute('playsinline')).toBe(true)
    expect(location.hash).not.toContain('#/note/')
  })
})

describe('inside a quoted note', () => {
  it('holds no links or buttons (it is one link itself): addresses, pictures, mentions and quotes are plain text', async () => {
    const quoted = ev(friend, `pic https://npub17nd4yu9anyd3004pumgrtazaacujjxwzj36thtqsxskjy0r5urgqf6950x.blossom.band/a.png hi nostr:${nip19.npubEncode(friend)} see nostr:${nip19.noteEncode('e'.repeat(64))}`, { created_at: 7000 })
    const a = boot({ events: [...world, quoted, ev(friend, `look nostr:${nip19.noteEncode(quoted.id)} and https://cdn.example/x.jpg`, { created_at: 8000 })], stored: { me } }); await tick(800)
    const q = a.root.querySelector('a.quote')!
    expect(q.querySelectorAll('a, button')).toHaveLength(0); expect(q.textContent).toContain('[picture · …blossom.band]'); expect(q.querySelector('img')).toBeNull()
    const outer = q.closest('article')!.querySelector('button.pic-btn')!; expect(outer.textContent).toContain('cdn.example')
  })
  it('a very long site name is shortened on the button', async () => {
    const a = boot({ events: [...world, ev(friend, 'pic https://npub17nd4yu9anyd3004pumgrtazaacujjxwzj36thtqsxskjy0r5urgqf6950x.blossom.band/a.png', { created_at: 8000 })], stored: { me } }); await tick(800)
    expect(a.root.querySelector('button.pic-btn')!.textContent).toBe('Show image · …blossom.band')
  })
})

describe('the Popular view in Following', () => {
  const now = Math.floor(Date.now() / 1000)
  const btn = (a: ReturnType<typeof boot>, label: string) => [...a.root.querySelectorAll('.seg.feedmode button')].find((b) => b.textContent === label) as HTMLButtonElement
  const stranger = pk('9'), other = pk('8')
  const liked = ev(stranger, 'a note by a stranger my friend liked', { created_at: now - 3600 })
  const twice = ev(other, 'picked by two follows', { created_at: now - 7200 })
  const old = ev(other, 'liked two days ago', { created_at: now - 3 * 86400 })
  const disliked = ev(stranger, 'only a dislike', { created_at: now - 600 })
  const reply = ev(stranger, 'a reply someone liked', { created_at: now - 500, tags: [['e', 'd'.repeat(64), '', 'reply']] })
  const react = (who: string, target: Event, content = '+', at = now - 100) => ev(who, content, { kind: 7, created_at: at, tags: [['e', target.id], ['p', target.pubkey]] })
  const second = pk('b')
  const events = [...world.filter((e) => !(e.kind === 3 && e.pubkey === me)), list(me, 3, [['p', friend], ['p', second]]), liked, twice, old, disliked, reply,
    react(friend, liked), react(friend, twice), ev(second, '', { kind: 6, created_at: now - 50, tags: [['e', twice.id], ['p', twice.pubkey]] }), react(friend, old, '+', now - 2 * 86400), react(friend, disliked, '-'), react(friend, reply), react(stranger, liked)]
  it('shows notes by anyone that your follows reacted to or reposted in the last day, the most picked first, each saying who; not dislikes, old picks or replies', async () => {
    const a = boot({ events, stored: { me, feed: 'popular', names: '' } }); await tick(300)
    expect(btn(a, 'Popular').getAttribute('aria-pressed')).toBe('true')
    const cards = [...a.root.querySelectorAll('article.note')]
    expect(cards.map((c) => c.querySelector('.body')!.textContent)).toEqual(['picked by two follows', 'a note by a stranger my friend liked'])
    expect(cards[0]!.querySelector('.reposted')!.textContent).toMatch(/and 1 more reacted or reposted$/); expect(cards[1]!.querySelector('.reposted')!.textContent).toMatch(/reacted or reposted$/)
    expect(a.root.querySelector('details.folded')).toBeNull() // "outside your network" does not hide them
  })
  it('says so when there is nothing', async () => {
    const a = boot({ events: world, stored: { me, feed: 'popular' } }); await tick(300)
    expect(a.text()).toContain('Nothing that the people you follow reacted to or reposted in the last 24 hours.')
  })
})

describe('a picture inside a quoted note', () => {
  it('shows itself when pictures load by themselves and its author is followed (a tap opens the quoted note)', async () => {
    const quoted = ev(friend, 'desk https://image.nostr.build/q.png', { created_at: 7000 })
    const a = boot({ events: [...world, quoted, ev(friend, `look nostr:${nip19.noteEncode(quoted.id)}`, { created_at: 8000 })], stored: { me, autoImages: '1' } }); await tick(800)
    const q = a.root.querySelector('a.quote')!; expect(q.querySelector('img')!.getAttribute('src')).toBe('https://image.nostr.build/q.png'); expect(q.querySelectorAll('a, button')).toHaveLength(0)
  })
})

describe('pictures brought by someone the reader follows', () => {
  it('load by themselves (setting on) in a note a followed account reposted, and inside a note a followed account quotes, though the author is not followed', async () => {
    const shared = ev(far, 'stranger pic https://image.nostr.build/s.png', { created_at: 8000 })
    const quotedFar = ev(far, 'quoted stranger pic https://image.nostr.build/q2.png', { created_at: 7000 })
    const a = boot({ events: [...world, shared, quotedFar, ev(friend, JSON.stringify(shared), { kind: 6, created_at: 9000, tags: [['e', shared.id], ['p', far]] }), ev(friend, `see nostr:${nip19.noteEncode(quotedFar.id)}`, { created_at: 8500 })], stored: { me, autoImages: '1', settings: JSON.stringify({ rules: { repeatedText: true, burst: true, linkOnly: true, mentionFlood: true, notText: true, outsideNetwork: false }, maxDistance: 2, burstEvents: 5 }) } }); await tick(800) // the quoted stranger is outside the network: that rule off, or the filter hides the quote (and then shows no picture)
    const card = (text: string) => [...a.root.querySelectorAll('article.note')].find((n) => n.querySelector('.body')!.textContent!.startsWith(text))!
    expect(card('stranger pic').querySelector('.pic img')!.getAttribute('src')).toBe('https://image.nostr.build/s.png')
    expect(card('see').querySelector('a.quote img')!.getAttribute('src')).toBe('https://image.nostr.build/q2.png')
  })
})

describe('search', () => {
  const fab = (a: ReturnType<typeof boot>) => a.root.querySelector('button.fab-search') as HTMLButtonElement | null
  const type = async (a: ReturnType<typeof boot>, text: string) => { const i = a.root.querySelector('input.search-box') as HTMLInputElement; i.value = text; i.dispatchEvent(new Event('input')); await tick(30) }
  it('a round button bottom left opens it; it searches the notes Quill has shown and the names it knows, without asking any relay', async () => {
    const a = boot({ events: [...world, ev(friend, 'Café and nostr talk', { created_at: 8000 }), ev(friend, JSON.stringify({ name: 'Ana' }), { kind: 0 })], stored: { me } }); await tick(300)
    expect(fab(a)).not.toBeNull(); fab(a)!.click(); await tick(100)
    expect(a.root.querySelector('input.search-box')).not.toBeNull(); expect(fab(a)).toBeNull() // not on the search page itself
    const before = a.calls.n
    await type(a, 'cafe')
    expect(a.root.querySelector('.search-results article.note')!.textContent).toContain('Café and nostr talk')
    await type(a, 'an')
    expect(a.root.querySelector('.search-people')!.textContent).toContain('Ana'); expect(a.root.querySelector('.search-people')!.textContent).toContain('you follow')
    expect(a.calls.n).toBe(before)
    await type(a, 'zzzz'); expect(a.text()).toContain('Nothing like that in what Quill has loaded.')
    await type(a, nip19.npubEncode(friend)); expect(a.root.querySelector('.search-results a.button')!.getAttribute('href')).toBe(`#/user/${friend}`)
  })
  it('"Search in: The network" (in Filters) asks the search relays, a moment after typing, and shows only what they found', async () => {
    const far1 = ev(far, 'a far note about quill clients', { created_at: 7000 })
    const a = boot({ events: world, stored: { me }, searchable: [far1, ev(far, JSON.stringify({ name: 'Quill fan' }), { kind: 0 })] }); await tick(300)
    await a.go('#/search'); await tick(50); await type(a, 'quill')
    expect(a.text()).not.toContain('a far note about quill'); expect(a.root.querySelector('.search-filters-btn')!.textContent).toBe('Filters')
    pickFilter(a, 'The network'); await tick(900)
    expect(a.root.querySelector('.search-filters-btn')!.textContent).toBe('Filters · The network'); expect(a.text()).toContain('search.nos.today') // the hint says who sees the search
    expect(a.text()).toContain('a far note about quill clients'); expect(a.root.querySelector('.search-people')!.textContent).toContain('Quill fan')
  })
})

describe('searching a #tag', () => {
  it('also asks the reader\'s own relays for the latest notes with it, from anyone, and adds them to what was loaded', async () => {
    const far1 = ev(far, 'a far note with the tag #quilltest', { created_at: 7000, tags: [['t', 'quilltest']] })
    const a = boot({ events: [...world, far1, ev(friend, 'loaded one #quilltest', { created_at: 8000, tags: [['t', 'quilltest']] })], stored: { me } }); await tick(300)
    await a.go('#/search'); await tick(50)
    const i = a.root.querySelector('input.search-box') as HTMLInputElement; i.value = '#quilltest'; i.dispatchEvent(new Event('input')); await tick(20)
    expect(a.text()).toContain('Also asking your relays for #quilltest')
    await tick(700)
    const texts = [...a.root.querySelectorAll('.search-results > section.list article.note .body')].map((b) => b.textContent)
    expect(texts).toEqual(['loaded one #quilltest', 'a far note with the tag #quilltest'])
    expect(a.filters.some((f) => JSON.stringify((f as Record<string, unknown>)['#t']) === '["quilltest"]')).toBe(true)
  })
})

describe('the trust score on an account page', () => {
  it('appears after the page, with the score, its level and every reason; not on your own page', async () => {
    const a = boot({ events: [...world, ev(friend, JSON.stringify({ name: 'Ana' }), { kind: 0, created_at: 1 })], stored: { me } }); await tick(200)
    await a.go(`#/user/${friend}`); await tick(500)
    const card = a.root.querySelector('.trust')!; expect(card).not.toBeNull(); expect(card.textContent).toContain('/100'); expect(card.textContent).toContain('you follow it'); expect(card.textContent).toContain('not a verdict')
    await a.go(`#/user/${me}`); await tick(400); expect(a.root.querySelector('.trust')).toBeNull()
  })
})

describe('a quoted note held by few relays', () => {
  it('is asked for again, waiting for every relay, when the quick question did not find it; then it is shown inside', async () => {
    const quoted = ev(far, 'held by only one relay', { created_at: 7000 })
    const a = boot({ events: [...world, quoted, ev(friend, `look nostr:${nip19.neventEncode({ id: quoted.id, relays: ['wss://relay.example.com/'] })}`, { created_at: 8000 })], stored: { me, settings: JSON.stringify({ rules: { repeatedText: true, burst: true, linkOnly: true, mentionFlood: true, notText: true, outsideNetwork: false }, maxDistance: 2, burstEvents: 5 }) }, onlyWhenAll: (e) => e.id === quoted.id })
    await tick(1000)
    expect(a.root.querySelector('a.quote')!.textContent).toContain('held by only one relay')
  })
})

describe('the npub on an account page', () => {
  it('a tap copies the whole npub and says so for a moment', async () => {
    const copied: string[] = []
    const a = boot({ events: world, stored: { me }, copy: (x: string) => copied.push(x) }); await tick(200)
    await a.go(`#/user/${friend}`); await tick(300)
    const b = a.root.querySelector('.profile button.npub-copy') as HTMLButtonElement; expect(b.textContent).toMatch(/^npub1.+…/)
    b.click(); expect(copied).toEqual([nip19.npubEncode(friend)]); expect(b.textContent).toBe('Copied')
  })
})

describe('your own npub in Me', () => {
  it('a tap copies it too', async () => {
    const copied: string[] = []
    const a = boot({ events: world, stored: { me }, copy: (x: string) => copied.push(x) }); await tick(200)
    await a.go('#/me'); await tick(300)
    ;(a.root.querySelector('.account button.npub-copy') as HTMLButtonElement).click(); expect(copied).toEqual([nip19.npubEncode(me)])
  })
})

describe('topics you care about', () => {
  it('a note about one is marked "For you", the order of the feed unchanged; set in Settings, kept on this device', async () => {
    const a = boot({ events: [...world, ev(friend, 'all about relays today', { created_at: 8000 }), ev(friend, 'something else', { created_at: 8100 })], stored: { me, interests: 'relay' } }); await tick(300)
    const notes = [...a.root.querySelectorAll('article.note')]
    const marked = notes.filter((n) => n.classList.contains('interesting')).map((n) => n.querySelector('.body')!.textContent)
    expect(marked).toEqual(['all about relays today']); expect(notes.find((n) => n.classList.contains('interesting'))!.querySelector('.interest')!.textContent).toBe('For you: relay')
    expect(notes.map((n) => n.querySelector('.body')!.textContent).indexOf('something else')).toBeLessThan(notes.map((n) => n.querySelector('.body')!.textContent).indexOf('all about relays today')) // newest first, as always
    await a.go('#/settings'); await tick(100)
    const area = a.root.querySelector('textarea.interests') as HTMLTextAreaElement; expect(area.value).toBe('relay')
    area.value = 'relay\nSomething'; area.dispatchEvent(new Event('change')); expect(a.mem.get('interests')).toBe('relay\nsomething')
  })
})

describe('long-form articles', () => {
  const article = (over: Partial<Event> = {}) => ev(friend, '# Intro\n\nSome **bold** text with [a link](https://example.com/x).\n\n- point one\n- point two', { kind: 30023, created_at: 7000, tags: [['d', 'my-post'], ['title', 'Why relays matter'], ['summary', 'A short take'], ['published_at', '1700000000']], ...over })
  it('a note that references one shows a button with its title; the article reads as text with its title, author and blocks', async () => {
    const naddr = nip19.naddrEncode({ kind: 30023, pubkey: friend, identifier: 'my-post' })
    const a = boot({ events: [...world, article(), ev(friend, JSON.stringify({ name: 'Ana' }), { kind: 0 }), ev(friend, `new post nostr:${naddr}`, { created_at: 8000 })], stored: { me } }); await tick(900)
    const link = a.root.querySelector('a.article-link') as HTMLAnchorElement; expect(link.textContent).toBe('Read: Why relays matter'); expect(link.getAttribute('href')).toBe(`#/article/${naddr}`)
    await a.go(`#/article/${naddr}`); await tick(400)
    const art = a.root.querySelector('article.article')!
    expect(art.querySelector('h2')!.textContent).toBe('Why relays matter'); expect(art.textContent).toContain('Ana'); expect(art.textContent).toContain('A short take')
    expect(art.querySelector('.article-body h3')!.textContent).toBe('Intro'); expect(art.querySelector('.article-body p')!.textContent).toBe('Some bold text with a link (https://example.com/x).')
    expect([...art.querySelectorAll('.article-body li')].map((x) => x.textContent)).toEqual(['point one', 'point two'])
  })
  it('a missing article says so', async () => {
    const naddr = nip19.naddrEncode({ kind: 30023, pubkey: friend, identifier: 'nope' })
    const a = boot({ events: world, stored: { me } }); await tick(200); await a.go(`#/article/${naddr}`); await tick(400)
    expect(a.text()).toContain('That article was not found')
  })
})

describe('NIP-22 comments in threads, Mentions and the numbers under your notes', () => {
  it('a thread shows kind 1111 comments in their place, next to kind 1 replies, comments on comments included', async () => {
    const rootNote = ev(friend, 'the root note', { created_at: 7000 })
    const reply1 = ev(far, 'a classic reply', { created_at: 7100, tags: [['e', rootNote.id, '', 'root'], ['p', friend]] })
    const c1 = ev(far, 'a comment', { kind: 1111, created_at: 7200, tags: [['E', rootNote.id], ['K', '1'], ['P', friend], ['e', rootNote.id], ['k', '1'], ['p', friend]] })
    const c2 = ev(friend, 'a comment on the comment', { kind: 1111, created_at: 7300, tags: [['E', rootNote.id], ['K', '1'], ['P', friend], ['e', c1.id], ['k', '1111'], ['p', far]] })
    const settings = JSON.stringify({ rules: { repeatedText: true, burst: true, linkOnly: true, mentionFlood: true, notText: true, outsideNetwork: false }, maxDistance: 2, burstEvents: 5 })
    const a = boot({ events: [...world, rootNote, reply1, c1, c2], stored: { me, settings } }); await tick(200)
    await a.go(`#/note/${rootNote.id}`); await tick(400)
    expect(a.text()).toContain('a classic reply'); expect(a.text()).toContain('a comment'); expect(a.text()).toContain('a comment on the comment')
    const c2card = [...a.root.querySelectorAll('article.note')].find((n) => n.querySelector('.body')!.textContent === 'a comment on the comment')!
    const c1card = [...a.root.querySelectorAll('article.note')].find((n) => n.querySelector('.body')!.textContent === 'a comment')!
    expect(c1card.closest('.reply')!.getAttribute('data-depth')).toBe('0'); expect(c2card.closest('.reply')!.getAttribute('data-depth')).toBe('1') // the comment on the comment sits under it
    expect(c1card.closest('.reply')!.contains(c2card)).toBe(true)
  })
  it('a comment on your note shows in Mentions', async () => {
    const mine = ev(me, 'my note', { created_at: 7000 })
    const c = ev(friend, 'commenting on yours', { kind: 1111, created_at: 7100, tags: [['E', mine.id], ['K', '1'], ['P', me], ['e', mine.id], ['k', '1'], ['p', me]] })
    const a = boot({ events: [...world, mine, c], stored: { me } }); await tick(200); await a.go('#/mentions'); await tick(500)
    expect(a.text()).toContain('commenting on yours')
  })
})

describe('notes saved for later', () => {
  const menuItem = (n: Element, label: string) => { (n.querySelector('.more-btn') as HTMLButtonElement).click(); return [...n.querySelectorAll('.more-list button')].find((b) => b.textContent === label) as HTMLButtonElement | undefined }
  it('"Save for later" in the … keeps the whole note on the device; Me links to the list; it survives a restart; "Remove from saved" takes it out', async () => {
    const note = ev(friend, 'worth reading later', { created_at: 8000 })
    const a = boot({ events: [...world, note], stored: { me } }); await tick(300)
    const card = [...a.root.querySelectorAll('article.note')].find((n) => n.textContent!.includes('worth reading later'))!
    menuItem(card, 'Save for later')!.click(); await tick(30)
    expect(JSON.parse(a.mem.get(`saved:${me}`)!)[0].event.id).toBe(note.id)
    await a.go('#/me'); await tick(300); const link = a.root.querySelector('a[href="#/me/saved"]')!; expect(link.textContent).toBe('1 saved')
    const b = boot({ events: world.filter((e) => e.id !== note.id), stored: { me, [`saved:${me}`]: a.mem.get(`saved:${me}`)! } }); await tick(200) // the note is gone from the relays: still there
    await b.go('#/me/saved'); await tick(300)
    expect(b.text()).toContain('Saved notes · 1'); expect(b.text()).toContain('worth reading later')
    const saved = [...b.root.querySelectorAll('article.note')].find((n) => n.textContent!.includes('worth reading later'))!
    menuItem(saved, 'Remove from saved')!.click(); await tick(300)
    expect(b.mem.has(`saved:${me}`)).toBe(false); expect(b.text()).toContain('No saved notes yet')
  })
  it('a saved note whose signature does not check out is dropped when read back', async () => {
    const note = ev(friend, 'tampered later', { created_at: 8000 })
    const bad = JSON.stringify([{ event: { ...note, content: 'tampered' }, at: 1 }]) // the test verifier refuses 'tampered' (as a real one refuses any change after signing)
    const a = boot({ events: world, stored: { me, [`saved:${me}`]: bad } }); await tick(200); await a.go('#/me/saved'); await tick(300)
    expect(a.text()).not.toContain('tampered'); expect(a.text()).toContain('No saved notes yet')
  })
})

describe('zaps under your notes', () => {
  it('Me shows the sats your note got (⚡) and, on a tap, who sent how much', async () => {
    const mine = ev(me, 'zap me', { created_at: 9000 })
    const req = { kind: 9734, pubkey: friend, id: 'r'.repeat(64), sig: '', created_at: 1, content: '', tags: [['e', mine.id], ['p', me], ['amount', '1000000']] }
    const receipt = ev(pk('f'), '', { kind: 9735, created_at: 9100, tags: [['e', mine.id], ['p', me], ['bolt11', 'lnbc10u1abc'], ['description', JSON.stringify(req)]] })
    const a = boot({ events: [...world, mine, receipt, ev(friend, JSON.stringify({ name: 'Ana' }), { kind: 0 })], stored: { me } }); await tick(200)
    await a.go('#/me'); await tick(900)
    const card = [...a.root.querySelectorAll('article.note')].find((n) => n.textContent!.includes('zap me'))!
    const reach = card.querySelector('.reach') as HTMLElement; expect(reach.textContent).toContain('1,000'); expect(reach.getAttribute('aria-label')).toContain('1 zap (1,000 sats)')
    reach.click(); expect(card.querySelector('.reach-who')!.textContent).toContain('Ana · 1,000 sats')
  })
  it('other people\'s notes show their zaps too (only the zaps: no reaction or repost counts), from any sender, and not your own notes twice', async () => {
    const theirs = ev(friend, 'zap my friend', { created_at: 9000 }), plain = ev(friend, 'nobody zapped this', { created_at: 8900 })
    const req = { kind: 9734, pubkey: far, id: 'r'.repeat(64), sig: '', created_at: 1, content: '', tags: [['e', theirs.id], ['p', friend], ['amount', '2100000']] }
    const receipt = ev(pk('e'), '', { kind: 9735, created_at: 9100, tags: [['e', theirs.id], ['p', friend], ['bolt11', 'lnbc21u1abc'], ['description', JSON.stringify(req)]] })
    const reaction = ev(far, '+', { kind: 7, tags: [['e', theirs.id], ['p', friend]] })
    const a = boot({ events: [...world, theirs, plain, receipt, reaction], stored: { me } }); await tick(1200)
    const card = (text: string) => [...a.root.querySelectorAll('article.note')].find((n) => n.textContent!.includes(text))!
    const reach = card('zap my friend').querySelector('.reach') as HTMLElement
    expect(reach.textContent).toContain('2,100'); expect(reach.getAttribute('aria-label')).toBe('1 zap (2,100 sats)') // the reaction is not counted
    expect(card('nobody zapped this').querySelector('.reach')).toBeNull()
  })
})

describe('searching only people or only notes', () => {
  it('Show: All | People | Notes limits the results, and the network search asks only for that', async () => {
    const a = boot({ events: [...world, ev(friend, 'about quillish things', { created_at: 8000 }), ev(friend, JSON.stringify({ name: 'Quillfan' }), { kind: 0 })], stored: { me }, searchable: [ev(far, 'a far quillish note', { created_at: 7000 }), ev(far, JSON.stringify({ name: 'Quill far' }), { kind: 0 })] }); await tick(300)
    await a.go('#/search'); await tick(50)
    const box = a.root.querySelector('input.search-box') as HTMLInputElement; box.value = 'quill'; box.dispatchEvent(new Event('input')); await tick(20)
    expect(a.root.querySelector('.search-people')).not.toBeNull(); expect(a.root.querySelector('.search-results article.note')).not.toBeNull()
    pickFilter(a, 'People'); await tick(20)
    expect(a.root.querySelector('.search-results article.note')).toBeNull(); expect(a.root.querySelector('.search-people')!.textContent).toContain('Quillfan')
    pickFilter(a, 'Notes'); await tick(20)
    expect(a.root.querySelector('.search-people')).toBeNull(); expect(a.root.querySelector('.search-results article.note')!.textContent).toContain('about quillish things')
    pickFilter(a, 'The network'); await tick(900)
    expect(a.text()).toContain('a far quillish note'); expect(a.text()).not.toContain('Quill far'); expect(a.text()).not.toContain('about quillish things') // notes only, network only
    expect(a.root.querySelector('.search-filters-btn')!.textContent).toBe('Filters · Notes · The network')
  })
})

describe('the network search, on its own', () => {
  it('shows only the network\'s answer; "What is loaded" goes back; opening the search again starts on What is loaded', async () => {
    const a = boot({ events: [...world, ev(friend, 'loaded quillish note', { created_at: 8000 })], stored: { me }, searchable: [ev(far, 'network quillish note', { created_at: 7000 })] }); await tick(300)
    await a.go('#/search'); await tick(50)
    const box = a.root.querySelector('input.search-box') as HTMLInputElement; box.value = 'quillish'; box.dispatchEvent(new Event('input')); await tick(20)
    expect(a.text()).toContain('loaded quillish note')
    pickFilter(a, 'The network'); await tick(900)
    expect(a.text()).toContain('network quillish note'); expect(a.text()).not.toContain('loaded quillish note')
    pickFilter(a, 'What is loaded'); await tick(20)
    expect(a.text()).toContain('loaded quillish note'); expect(a.text()).not.toContain('network quillish note')
    pickFilter(a, 'The network'); await tick(900); await a.go('#/'); await tick(100); await a.go('#/search'); await tick(100)
    expect(a.root.querySelector('.search-filters-btn')!.textContent).toBe('Filters'); expect(a.text()).toContain('loaded quillish note') // back on what is loaded
  })
})

describe('reading people where they write', () => {
  it('is on by default; the switch in Settings turns it off, is remembered, and the account page still loads', async () => {
    const a = boot({ stored: { me } }); await tick(80); await a.go('#/settings'); await tick(100)
    const sw = [...a.root.querySelectorAll('label.check')].find((r) => r.textContent!.includes('where they write'))!.querySelector('input') as HTMLInputElement
    expect(sw.checked).toBe(true)
    sw.checked = false; sw.dispatchEvent(new Event('change')); await tick(100)
    expect(a.mem.get('outbox')).toBe('0')
    await a.go(`#/user/${friend}`); await tick(200); expect(a.root.querySelector('.profile, .account, article.note')).not.toBeNull()
  })
})

describe('notes from people\'s own relays that arrive late', () => {
  const late = ev(far, 'written where only I write', { created_at: 2_000_000_000 })
  const w = [...world.map((e) => (e.kind === 3 && e.pubkey === me ? list(me, 3, [['p', friend], ['p', far]]) : e)), ev(far, '', { kind: 10002, tags: [['r', 'wss://far.example']] })]
  for (const wideScreen of [false, true]) {
    it(`are added once they come, without holding the page up (${wideScreen ? 'wide screen' : 'phone'})`, async () => {
      const a = boot({ events: w, stored: { me }, elsewhere: { relay: 'wss://far.example', events: [late], delayMs: 900 }, wide: { value: wideScreen } }); await tick(500)
      const feed = () => (wideScreen ? a.root.querySelector('.col[data-col="following"]') : a.root.querySelector('main.view'))?.textContent ?? ''
      expect(feed()).toContain('a post from my friend'); expect(feed()).not.toContain('written where only I write') // drawn before it came
      await tick(900)
      expect(feed()).toContain('written where only I write')
    })
  }
  it('while the reader is further down, nothing moves: a button at the top says how many came, and brings them in', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ev(friend, `older note ${i}`, { created_at: 1_000_000 + i }))
    const ancient = ev(far, 'an old note from where only I write', { created_at: 5 }) // older than anything on the page: it would not show up, so it is not counted
    const a = boot({ events: [...w, ...many], stored: { me }, elsewhere: { relay: 'wss://far.example', events: [late, ancient], delayMs: 900 } }); await tick(500)
    const main = a.root.querySelector('main.view') as HTMLElement
    Object.defineProperty(main, 'scrollTop', { configurable: true, get: () => 900, set: () => {} }) // reading further down
    await tick(900)
    expect(a.text()).not.toContain('written where only I write')
    const btn = a.root.querySelector('button.late-notes') as HTMLElement; expect(btn.textContent).toBe('↑ 1 more note from someone you follow')
    btn.click(); await tick(1500)
    expect(a.text()).toContain('written where only I write'); expect(a.root.querySelector('button.late-notes')).toBeNull()
  })
  it('with the switch off, nobody else\'s relay is asked', async () => {
    const a = boot({ events: w, stored: { me, outbox: '0' }, elsewhere: { relay: 'wss://far.example', events: [late], delayMs: 10 } }); await tick(600)
    expect(a.text()).not.toContain('written where only I write')
  })
})

describe('real profile pictures', () => {
  const withPics = [...world.filter((e) => !(e.kind === 0 && e.pubkey === friend)), ev(friend, JSON.stringify({ name: 'Ana', picture: 'https://img.example/ana.jpg' }), { kind: 0 }), ev(far, JSON.stringify({ name: 'Spammy', picture: 'https://img.example/spam.jpg' }), { kind: 0 }), ev(far, 'a stranger with a picture', { created_at: 9500, tags: [['p', me]] })]
  it('off by default; once on, only people you follow show theirs (strangers keep the drawn one); a picture that fails goes back to the drawn one', async () => {
    const a = boot({ events: withPics, stored: { me } }); await tick(300)
    expect(a.root.querySelector('.avatar.photo')).toBeNull()
    await a.go('#/settings'); await tick(80)
    const sw = [...a.root.querySelectorAll('label.check')].find((r) => r.textContent!.includes('Real profile pictures'))!.querySelector('input') as HTMLInputElement
    expect(sw.checked).toBe(false); expect(a.text()).toContain('see that server\'s address, not yours')
    sw.checked = true; sw.dispatchEvent(new Event('change')); await tick(100); expect(a.mem.get('realAvatars')).toBe('1')
    await a.go('#/'); await tick(300)
    const imgs = [...a.root.querySelectorAll('.avatar.photo img')] as HTMLImageElement[]
    expect(imgs.length).toBeGreaterThan(0); expect(imgs.every((i) => i.getAttribute('src') === 'https://img.example/ana.jpg')).toBe(true)
    expect(imgs[0]!.getAttribute('referrerpolicy')).toBe('no-referrer')
    await a.go('#/mentions'); await tick(300)
    expect(a.root.querySelector('img[src="https://img.example/spam.jpg"]')).toBeNull() // a stranger: drawn avatar
    await a.go('#/'); await tick(300)
    const one = a.root.querySelector('.avatar.photo img') as HTMLImageElement; const box = one.parentElement!
    one.dispatchEvent(new Event('error')); expect(box.isConnected).toBe(false)
  })
})

describe('profile pictures through Quill\'s server', () => {
  it('with a thumbnail service, the picture is asked there, small, never straight from its site', async () => {
    const withPic = [...world.filter((e) => !(e.kind === 0 && e.pubkey === friend)), ev(friend, JSON.stringify({ name: 'Ana', picture: 'https://img.example/ana.jpg?x=1' }), { kind: 0 })]
    const a = boot({ events: withPic, stored: { me, realAvatars: '1' }, avatarProxy: 'https://quill.example/avatar' }); await tick(400)
    const src = (a.root.querySelector('.avatar.photo img') as HTMLImageElement).getAttribute('src')
    expect(src).toBe('https://quill.example/avatar?u=https%3A%2F%2Fimg.example%2Fana.jpg%3Fx%3D1&s=96')
  })
})

describe('coming back to a list', () => {
  it('a note opened from Following and then left shows Following again at once, where it was, without asking the relays again', async () => {
    const a = boot({ events: [...world, ...Array.from({ length: 40 }, (_, i) => ev(friend, `note number ${i}`, { created_at: 5000 + i }))], stored: { me } }); await tick(400)
    const main = () => a.root.querySelector('main.view') as HTMLElement
    const list = main().querySelector('article.note')!.parentElement!
    main().scrollTop = 700
    const id = (main().querySelector('article.note') as HTMLElement).dataset.id!
    await a.go(`#/note/${id}`); await tick(200)
    const calls = a.calls.n
    await a.go(''); await tick(50)
    expect(a.calls.n).toBe(calls) // nothing asked again
    expect(main().contains(list)).toBe(true) // the very same list, with whatever was unfolded
    expect(main().scrollTop).toBe(700)
  })
  it('after Settings, the list is loaded again (a change made there must show)', async () => {
    const a = boot({ stored: { me } }); await tick(400)
    await a.go('#/settings'); await tick(80)
    const calls = a.calls.n
    await a.go(''); await tick(200)
    expect(a.calls.n).toBeGreaterThan(calls)
  })
})
