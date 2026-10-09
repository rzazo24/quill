// The app: a login, two lists (following, mentions) and a thread view, all read-only. State lives here; everything else is a function of it.
import { nip19 } from 'nostr-tools'
import { parseIdentity } from '../core/identity.js'
import { mentionedKeys } from '../core/refs.js'
import { judgeAll, tally, type Judged, type Settings } from '../core/verdict.js'
import { loadFollowing, loadMentions, loadNames, loadThread, type Thread, type ThreadNode } from '../data/feed.js'
import { contextOf, loadSession, type Session } from '../data/session.js'
import { memo, type Fetcher } from '../net/fetcher.js'
import { h } from './dom.js'
import { detectLang, t, type Lang } from './i18n.js'
import { renderJudged, renderList, renderSettings, renderSummary, renderTree, type View } from './render.js'
import { parseLang, parseSettings, parseWords, safeGet, safeSet, type KV } from './store.js'

export interface Deps { fetcher: Fetcher; storage?: KV; languages?: readonly string[]; location: Pick<Location, 'hash'>; onHash: (cb: () => void) => void; setHash: (h: string) => void }

type Route = { name: 'following' } | { name: 'mentions' } | { name: 'note'; id: string }
export function parseRoute(hash: string): Route {
  const m = /^#\/note\/(.+)$/.exec(hash)
  if (m) {
    const raw = m[1]!
    if (/^[0-9a-f]{64}$/i.test(raw)) return { name: 'note', id: raw.toLowerCase() }
    try {
      const d = nip19.decode(raw)
      if (d.type === 'note') return { name: 'note', id: d.data }
      if (d.type === 'nevent') return { name: 'note', id: d.data.id }
    } catch { /* not a note id */ }
  }
  return hash === '#/mentions' ? { name: 'mentions' } : { name: 'following' }
}

export function startApp(root: HTMLElement, deps: Deps): void {
  const fetcher = memo(deps.fetcher)
  const kv = deps.storage
  let lang: Lang = parseLang(safeGet(kv, 'lang')) ?? detectLang(deps.languages)
  let settings: Settings = parseSettings(safeGet(kv, 'settings'))
  let words: string[] = parseWords(safeGet(kv, 'words'))
  let me = ((): string | null => { const r = parseIdentity(safeGet(kv, 'me') ?? ''); return r.ok ? r.pubkey : null })()
  let session: Session | null = null
  let names = new Map<string, string>()
  let showSettings = false
  let loginError: string | null = null
  let status: string | null = null
  let body: HTMLElement | null = null
  let run = 0 // a newer navigation makes older loads stop touching the page
  let shownRoute = '' // which view `body` belongs to: old content must not stay on screen under a new tab

  const view = (): View => ({ lang, names })
  const ctx = () => contextOf(session!, { mutedWords: words, mutedKeys: [] })

  async function ensureSession(): Promise<boolean> {
    if (session || !me) return !!session
    status = t(lang, 'loadingFollows'); draw()
    try { session = await loadSession(fetcher, me) } catch { status = null; return false }
    return true
  }

  async function nameThem(items: Judged[]): Promise<void> {
    const keys = items.flatMap((j) => [j.event.pubkey, ...mentionedKeys(j.event.content)]).filter((k) => !names.has(k))
    if (!keys.length) return
    for (const [k, n] of await loadNames(fetcher, keys)) names.set(k, n)
  }

  async function load(): Promise<void> {
    const mine = ++run
    if (!me) return draw()
    if (!(await ensureSession()) || mine !== run) return
    const route = parseRoute(deps.location.hash)
    const key = JSON.stringify(route)
    if (key !== shownRoute) { body = null; shownRoute = key }
    status = t(lang, 'loadingFeed'); draw()
    let content: HTMLElement
    try {
      if (route.name === 'note') {
        const th = await loadThread(fetcher, route.id, ctx(), settings)
        if (mine !== run) return
        if (!th) content = h('p', { class: 'empty' }, t(lang, 'noNote'))
        else { await nameThem([...(th.root ? [th.root] : []), ...flat(th.replies)]); content = threadView(th) }
      } else {
        const items = route.name === 'mentions' ? await loadMentions(fetcher, ctx(), settings) : await loadFollowing(fetcher, ctx(), settings)
        if (mine !== run) return
        await nameThem(items)
        content = h('div', {}, renderSummary(tally(items), view(), toggleSettings), renderList(items, view()))
      }
    } catch { content = h('p', { class: 'empty' }, t(lang, 'noNote')) }
    if (mine !== run) return
    status = null; body = content; draw()
  }

  const flat = (nodes: ThreadNode[]): Judged[] => nodes.flatMap((n) => [n.item, ...flat(n.children)])

  function threadView(th: Thread): HTMLElement {
    const all = [...(th.root ? [th.root] : []), ...flat(th.replies)]
    return h('div', {},
      h('a', { class: 'back', href: '#/' }, t(lang, 'back')),
      renderSummary(tally(all), view(), toggleSettings),
      th.root ? renderJudged(th.root, view()) : null,
      h('h3', {}, `${th.total} ${t(lang, 'replies')}`),
      ...renderTree(th.replies, view()),
    )
  }

  function toggleSettings(): void { showSettings = !showSettings; draw() }

  function changeSettings(s: Settings): void { settings = s; safeSet(kv, 'settings', JSON.stringify(s)); void load() }
  function changeWords(text: string): void { words = parseWords(text); safeSet(kv, 'words', words.join('\n')); void load() }

  function login(raw: string): void {
    const r = parseIdentity(raw)
    if (!r.ok) { loginError = t(lang, 'loginBad'); return draw() }
    me = r.pubkey; loginError = null; session = null; body = null; shownRoute = ''
    safeSet(kv, 'me', me)
    void load()
  }

  function draw(): void {
    const route = parseRoute(deps.location.hash)
    const tab = (name: 'following' | 'mentions', href: string) => h('a', { href, class: route.name === name ? 'tab on' : 'tab', ...(route.name === name ? { 'aria-current': 'page' } : {}) }, t(lang, name))
    const input = h('input', { type: 'text', placeholder: t(lang, 'loginPlaceholder'), autocomplete: 'off', spellcheck: 'false', 'aria-label': t(lang, 'loginTitle') })
    const loginForm = h('form', { class: 'login', onSubmit: (e: Event) => { e.preventDefault(); login(input.value) } },
      h('h2', {}, t(lang, 'loginTitle')), h('p', {}, t(lang, 'loginHelp')), input, ' ', h('button', { type: 'submit' }, t(lang, 'loginButton')),
      loginError ? h('p', { class: 'error', role: 'alert' }, loginError) : null)
    root.replaceChildren(
      h('header', { class: 'top' },
        h('h1', {}, h('a', { href: '#/' }, 'Quill')), h('span', { class: 'tag' }, t(lang, 'tagline')),
        h('nav', {},
          me ? tab('following', '#/') : null, me ? tab('mentions', '#/mentions') : null,
          h('button', { type: 'button', class: 'link', onClick: () => { lang = lang === 'en' ? 'es' : 'en'; safeSet(kv, 'lang', lang); void load() } }, t(lang, 'language')),
          me ? h('button', { type: 'button', class: 'link', onClick: () => { me = null; session = null; body = null; shownRoute = ''; safeSet(kv, 'me', null); draw() } }, t(lang, 'signOut')) : null),
      ),
      h('main', {},
        !me ? loginForm : null,
        me && showSettings ? renderSettings({ settings, words, graph: session ? { ...session.graphInfo, loaded: session.graphInfo.graph.loaded } : null, onSettings: changeSettings, onWords: changeWords }, view()) : null,
        me && status ? h('p', { class: 'status', role: 'status' }, status) : null,
        me && body ? body : null),
    )
  }

  deps.onHash(() => { void load() })
  draw()
  void load()
}
