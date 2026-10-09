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

function boot(opts: { events?: Event[]; delayMs?: number; stored?: Record<string, string>; languages?: string[]; env?: { ios: boolean; standalone: boolean }; clock?: { now: number }; newer?: { value: boolean } } = {}) {
  const root = document.createElement('div'); document.body.append(root); roots.push(root)
  const location = { hash: '' }, listeners: (() => void)[] = []
  const mem = new Map(Object.entries(opts.stored ?? {})), visible: (() => void)[] = [], ticks: (() => void)[] = [], polls: (() => void)[] = [], reloads = { n: 0 }, asked = { n: 0 }, base = relays(opts.events ?? world, opts.delayMs), calls = { n: 0 }
  startApp(root, {
    fetcher: { query: (f) => { calls.n++; return base.query(f) } }, env: opts.env, nowMs: opts.clock ? () => opts.clock!.now : undefined, onVisible: (cb) => visible.push(cb), onTick: (cb) => ticks.push(cb), onPoll: (cb) => polls.push(cb), reload: () => { reloads.n++ },
    checkVersion: opts.newer ? async () => { asked.n++; return opts.newer!.value } : undefined, languages: opts.languages ?? ['en'], location, onHash: (cb) => listeners.push(cb), setHash: (h) => { location.hash = h; listeners.forEach((l) => l()) },
    storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) },
  })
  const go = async (hash: string) => { location.hash = hash; listeners.forEach((l) => l()); await tick() }
  return { root, go, mem, calls, reloads, asked, tick: () => ticks.forEach((t) => t()), poll: () => polls.forEach((t) => t()), comeBack: () => visible.forEach((v) => v()), text: () => root.textContent ?? '' }
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
  it('the Me page shows who you are, your own notes (replies included), the settings and sign out', async () => {
    const mineRoot = ev(me, 'a note I wrote', { created_at: 3000 }), mineReply = ev(me, 'a reply I wrote', { created_at: 4000, tags: [['e', 'e'.repeat(64), '', 'root']] })
    const a = boot({ events: [...world, mineRoot, mineReply, ev(me, JSON.stringify({ name: 'Raúl' }), { kind: 0 })], stored: { me } }); await tick(80); await a.go('#/me'); await tick(60)
    expect(a.text()).toContain('Raúl'); expect(a.root.querySelector('.account .avatar')!.textContent).toBe('RA')
    expect(a.text()).toContain('My notes'); expect(a.text()).toContain('a note I wrote'); expect(a.text()).toContain('a reply I wrote')
    expect(a.root.querySelector('.settings')).not.toBeNull(); expect(a.text()).toContain('Sign out')
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
