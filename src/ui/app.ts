// The app: a login, two lists (following, mentions), a thread view, and — when a signer is configured — writing, replying and reacting through the
// user's remote signer. State lives here; everything else is a function of it.
import { nip19, type Event as NostrEvent } from 'nostr-tools'
import { hashtagTags, mentionTags, mergeTags, reactionTags, replyTags } from '../core/compose.js'
import { parseIdentity } from '../core/identity.js'
import { mentionedKeys, shortNpub } from '../core/refs.js'
import { judgeAll, tally, type Judged, type Settings } from '../core/verdict.js'
import { loadFollowing, loadMentions, loadMine, loadNames, loadThread, type Thread, type ThreadNode } from '../data/feed.js'
import { contextOf, loadSession, type Session } from '../data/session.js'
import { DEFAULT_RELAYS, memo, type Fetcher } from '../net/fetcher.js'
import { failedRelays, type Publisher } from '../net/publisher.js'
import { PipelineError, signAndPublish, type Published, type SignerApi, type Step } from '../sign/pipeline.js'
import { checkTemplate, MAX_NOTE_CHARS, type Template } from '../sign/policy.js'
import { h } from './dom.js'
import { icon } from './icons.js'
import { detectLang, problemText, t, type Key, type Lang } from './i18n.js'
import { avatarEl, nameOf, renderJudged, renderList, renderSettings, renderSummary, renderTree, type View } from './render.js'
import { reactionBar, renderSignArea, type Composer, type Flash, type Review } from './sign-ui.js'
import { installHint, type Env } from './install.js'
import { parseLang, parseSettings, parseWords, safeGet, safeSet, type KV } from './store.js'

export interface Deps {
  fetcher: Fetcher; storage?: KV; languages?: readonly string[]; location: Pick<Location, 'hash'>; onHash: (cb: () => void) => void; setHash: (h: string) => void
  /** Without these the app is read-only. */
  signer?: SignerApi; publisher?: Publisher; relays?: string[]; copy?: (text: string) => void; nowMs?: () => number
  /** Reads the clipboard (needs a tap; may be refused). */
  readClipboard?: () => Promise<string>
  /** Facts about where the page runs (iPhone? installed?), and a hook for "the page came back to the foreground". */
  env?: Env; onVisible?: (cb: () => void) => void
  /** Is there a newer build of the app on the server? Asked at start, whenever the app comes back to the foreground and on every `onTick`. */
  checkVersion?: () => Promise<boolean>; onTick?: (cb: () => void) => void; reload?: () => void
}

type Route = { name: 'following' } | { name: 'mentions' } | { name: 'me' } | { name: 'note'; id: string }
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
  return hash === '#/mentions' ? { name: 'mentions' } : hash === '#/me' ? { name: 'me' } : { name: 'following' }
}

export function startApp(root: HTMLElement, deps: Deps): void {
  const fetcher = memo(deps.fetcher)
  const kv = deps.storage
  const { signer, publisher } = deps
  const relays = deps.relays ?? DEFAULT_RELAYS
  let lang: Lang = parseLang(safeGet(kv, 'lang')) ?? detectLang(deps.languages)
  let settings: Settings = parseSettings(safeGet(kv, 'settings'))
  let words: string[] = parseWords(safeGet(kv, 'words'))
  let me = ((): string | null => { const r = parseIdentity(safeGet(kv, 'me') ?? ''); return r.ok ? r.pubkey : null })()
  let session: Session | null = null
  let names = new Map<string, string>()
  let loginError: string | null = null
  let status: string | null = null
  let body: HTMLElement | null = null
  let run = 0 // a newer navigation makes older loads stop touching the page
  let shownRoute = '' // which view `body` belongs to: old content must not stay on screen under a new tab
  // signing
  let connect: { uri: string; claveLink: string } | null = null
  let connectOpen = false
  let bunkerText = ''
  let linkOpen = false
  let flash: Flash | null = null
  let composer: Composer | null = null
  let review: Review | null = null
  let step: Step | null = null
  let result: Published | null = null
  let busy = false // one signature at a time
  let signing: AbortController | null = null // lets the user stop waiting for the signer
  let current: Promise<boolean> | null = null // the action in progress
  let lastLoadAt = 0
  let updateReady = false

  const actions = (j: Judged) => (signer?.state === 'connected' ? [reactionBar(j.event, (emoji) => void react(j.event, emoji), () => startReply(j.event), view())] : [])
  const view = (): View => ({ lang, names, actions: signer ? actions : undefined, nowMs: deps.nowMs?.() })
  const ctx = () => contextOf(session!, { mutedWords: words, mutedKeys: [] })
  const who = () => (signer?.pubkey ? nameOf(view(), signer.pubkey) : '')

  async function ensureSession(): Promise<boolean> {
    if (session || !me) return !!session
    status = t(lang, 'loadingFollows'); draw()
    try { session = await loadSession(fetcher, me) } catch { status = null; return false }
    return true
  }

  async function nameThem(items: Judged[]): Promise<void> {
    const keys = [...items.flatMap((j) => [j.event.pubkey, ...mentionedKeys(j.event.content)]), ...(signer?.pubkey ? [signer.pubkey] : [])].filter((k) => !names.has(k))
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
        const items = route.name === 'mentions' ? await loadMentions(fetcher, ctx(), settings) : route.name === 'me' ? await loadMine(fetcher, ctx(), settings) : await loadFollowing(fetcher, ctx(), settings)
        if (mine !== run) return
        await nameThem(items)
        if (route.name === 'me' && !names.has(me)) for (const [k, n] of await loadNames(fetcher, [me])) names.set(k, n)
        content = route.name === 'me' ? renderList(items, view()) : h('div', { class: 'stack' }, renderSummary(tally(items), view(), toggleSettings), renderList(items, view()))
      }
    } catch { content = h('p', { class: 'empty' }, t(lang, 'noNote')) }
    if (mine !== run) return
    status = null; body = content; lastLoadAt = deps.nowMs?.() ?? Date.now(); draw()
  }

  async function checkUpdate(): Promise<void> {
    if (!deps.checkVersion || updateReady) return
    try { if (await deps.checkVersion()) { updateReady = true; draw() } } catch { /* a failed check says nothing */ }
  }

  /** Reads everything again from the relays (an installed app has no pull-to-refresh). */
  function refresh(): void { fetcher.clear(); session = null; void load() }

  const flat = (nodes: ThreadNode[]): Judged[] => nodes.flatMap((n) => [n.item, ...flat(n.children)])

  function threadView(th: Thread): HTMLElement {
    const all = [...(th.root ? [th.root] : []), ...flat(th.replies)]
    return h('div', { class: 'stack' },
      h('a', { class: 'back', href: '#/' }, icon('back', 16), t(lang, 'back')),
      renderSummary(tally(all), view(), toggleSettings),
      th.root ? renderJudged(th.root, view()) : null,
      h('h3', {}, `${th.total} ${t(lang, 'replies')}`),
      ...renderTree(th.replies, view()),
    )
  }

  function toggleSettings(): void { deps.setHash('#/me') } // the filter settings live on the Me page
  function changeSettings(s: Settings): void { settings = s; safeSet(kv, 'settings', JSON.stringify(s)); void load() }
  function changeWords(text: string): void { words = parseWords(text); safeSet(kv, 'words', words.join('\n')); void load() }

  function login(raw: string): void {
    const r = parseIdentity(raw)
    if (!r.ok) { loginError = t(lang, 'loginBad'); return draw() }
    me = r.pubkey; loginError = null; session = null; body = null; shownRoute = ''
    safeSet(kv, 'me', me)
    void load()
  }

  // ---- signing ----
  const say = (kind: Flash['kind'], text: string) => { flash = { kind, text } }

  /** The signer's key and the account being read must be the same one; with nobody logged in yet, the signer's key is who you are. */
  async function checkIdentity(): Promise<void> {
    if (!signer || signer.state !== 'connected' || !signer.pubkey) return
    if (me && me !== signer.pubkey) {
      const other = shortNpub(signer.pubkey)
      await signer.disconnect(); connect = null; connectOpen = false
      say('error', t(lang, 'wrongAccount', { who: other })); return draw()
    }
    flash = null; connectOpen = false; connect = null
    if (!me) { me = signer.pubkey; safeSet(kv, 'me', me); session = null; body = null; shownRoute = '' }
    void load()
  }

  signer?.onChange(() => { if (signer.state === 'connected') void checkIdentity(); else draw() })
  if (signer && me && signer.hasSavedSession()) {
    const resumed = signer.resume(me) // instant for sessions saved by this version; older ones ask the signer, which can take a while
    if (signer.state === 'connecting') say('info', t(lang, 'resuming'))
    void resumed.then((ok) => { if (!ok) flash = null; draw() })
  }

  function openConnect(): void { if (!signer) return; connectOpen = true; flash = null; draw() }
  async function pasteBunker(): Promise<void> {
    if (!signer) return
    let text = ''
    try { text = (await deps.readClipboard?.()) ?? '' } catch { /* refused or unavailable */ }
    if (!/^\s*bunker:\/\//i.test(text)) { say('error', t(lang, 'clipboardNoBunker')); return draw() }
    await bunker(text)
  }
  function startLink(): void {
    if (!signer) return
    flash = null
    const c = signer.startConnect(); connect = { uri: c.uri, claveLink: c.claveLink }
    void c.done.then((ok) => { if (!ok && signer.lastError) say('error', t(lang, 'connectFailed', { why: signer.lastError })); draw() })
    draw()
  }
  function cancelConnect(): void { connectOpen = false; connect = null; void signer?.disconnect(); draw() }
  async function bunker(text: string): Promise<void> {
    if (!signer) return
    flash = null; draw()
    if (!(await signer.connectBunker(text)) && signer.lastError) { say('error', t(lang, 'connectFailed', { why: signer.lastError })); draw() }
  }

  const sayPipelineError = (e: unknown): void => {
    if (e instanceof PipelineError && e.code === 'cancelled') say('info', t(lang, 'cancelledSigning'))
    else if (e instanceof PipelineError) say('error', t(lang, e.code === 'rate' ? 'e_rate' : e.code === 'no-signer' ? 'e_no_signer' : /did not answer within/.test(e.message) ? 'e_asleep' : 'e_not_signed', { why: e.message }))
    else say('error', t(lang, 'e_not_signed', { why: e instanceof Error ? e.message : String(e) }))
  }

  async function send(template: Template): Promise<boolean> {
    if (!signer || !publisher) return false
    // Still waiting for the signer to answer an earlier tap (e.g. Clave was closed): a new tap replaces it, so opening Clave and tapping again works.
    // Once the signature is made and the event is being sent, a second tap is ignored (no double posts).
    if (busy && step === 'waiting') { signing?.abort(); await current?.catch(() => {}) } else if (busy) return false
    busy = true; flash = null; result = null; const mine = signing = new AbortController(); draw()
    current = (async () => {
      try {
        result = await signAndPublish({ signer, publisher, kv, now: deps.nowMs, signal: mine.signal }, template, (s) => { step = s; draw() })
        step = null; fetcher.clear()
        return true
      } catch (e) { step = null; if (!(mine.signal.aborted && signing !== mine)) sayPipelineError(e); return false } finally { if (signing === mine) { busy = false; signing = null } draw() }
    })()
    return current
  }

  function templateFor(text: string, target?: NostrEvent): Template {
    const auto = mergeTags(mentionTags(text), hashtagTags(text))
    return { kind: 1, content: text, tags: target ? mergeTags(replyTags(target), auto) : auto, created_at: Math.floor((deps.nowMs?.() ?? Date.now()) / 1000) }
  }

  function startReply(target: NostrEvent): void { composer = { mode: 'reply', target, text: '' }; review = null; result = null; flash = null; draw(); root.querySelector('textarea')?.focus() }
  function startNote(): void { composer = { mode: 'note', text: '' }; draw(); root.querySelector('textarea')?.focus() }
  function doReview(): void {
    if (!composer) return
    let template: Template
    try { template = templateFor(composer.text, composer.target) } catch { return say('error', t(lang, 'p_tags')), draw() }
    const problem = checkTemplate(template)
    if (problem) { say('error', problemText(lang, problem, { max: MAX_NOTE_CHARS })); return draw() }
    flash = null; review = { template, target: composer.target, mentions: template.tags.filter((x) => x[0] === 'p').length }; draw()
  }
  async function publish(): Promise<void> {
    if (!review) return
    const ok = await send(review.template)
    if (ok) { review = null; composer = null; void load() }
  }
  async function react(target: NostrEvent, emoji: string): Promise<void> {
    const template: Template = { kind: 7, content: emoji, tags: reactionTags(target), created_at: Math.floor((deps.nowMs?.() ?? Date.now()) / 1000) }
    const problem = checkTemplate(template)
    if (problem) { say('error', problemText(lang, problem)); return draw() }
    if (await send(template)) say('info', `${emoji === '+' ? '👍' : emoji} → ${nameOf(view(), target.pubkey)}`)
    draw()
  }
  async function retry(): Promise<void> {
    if (!result || !publisher || busy) return
    busy = true; step = 'sending'; draw()
    try { const again = await publisher.publish(result.event, failedRelays(result.outcomes)); result = { event: result.event, outcomes: { ...result.outcomes, ...again } } } finally { busy = false; step = null; draw() }
  }

  function accountCard(): HTMLElement {
    return h('section', { class: 'account card' }, avatarEl(me!, view(), 'lg'),
      h('div', {}, h('strong', {}, nameOf(view(), me!)), h('div', { class: 'meta' }, shortNpub(me!))))
  }

  function draw(): void {
    const route = parseRoute(deps.location.hash)
    const tab = (name: 'following' | 'mentions' | 'me', href: string) => h('a', { href, class: route.name === name ? 'tab on' : 'tab', ...(route.name === name ? { 'aria-current': 'page' } : {}), onClick: (e: Event) => { if (route.name === name) { e.preventDefault(); refresh() } } }, t(lang, name))
    const input = h('input', { type: 'text', placeholder: t(lang, 'loginPlaceholder'), autocomplete: 'off', spellcheck: 'false', 'aria-label': t(lang, 'loginTitle') })
    const loginForm = h('form', { class: 'login card', onSubmit: (e: Event) => { e.preventDefault(); login(input.value) } },
      h('p', { class: 'tagline' }, t(lang, 'tagline')), h('h2', {}, t(lang, 'loginTitle')), h('p', {}, t(lang, 'loginHelp')), input, ' ', h('button', { type: 'submit', class: 'primary' }, t(lang, 'loginButton')),
      loginError ? h('p', { class: 'error', role: 'alert' }, loginError) : null)
    const signArea = signer ? renderSignArea({
      signer: signer.state, who: who() || (signer.pubkey ? shortNpub(signer.pubkey) : null), connect, connectOpen, flash, composer, review, step, result, relays, bunkerText, linkOpen,
    }, {
      openConnect, startLink, pasteBunker: () => void pasteBunker(), cancelConnect, bunker: (x) => void bunker(x), disconnect: () => { void signer.disconnect(); composer = review = result = null; flash = null; draw() }, copy: (x) => { deps.copy?.(x); say('info', t(lang, 'copied')); draw() },
      edit: (x) => { if (composer) composer.text = x }, review: doReview, publish: () => void publish(), back: () => { review = null; draw() }, cancelComposer: () => { composer = null; review = null; draw() },
      retry: () => void retry(), dismissResult: () => { result = null; draw() }, startNote, cancelSigning: () => signing?.abort(),
      editBunker: (x) => { bunkerText = x }, setLinkOpen: (o) => { linkOpen = o },
    }, view(), true, !me || route.name === 'me' ? 'me' : 'feed') : null
    const pills = h('div', { class: 'lang', role: 'group', 'aria-label': 'Language' }, ...(['en', 'es'] as const).map((l) =>
      h('button', { type: 'button', 'aria-pressed': String(lang === l), onClick: () => { if (lang !== l) { lang = l; safeSet(kv, 'lang', lang); void load() } } }, l.toUpperCase())))
    const statusEl = me && status ? h('p', { class: 'status', role: 'status' }, status) : null
    const signOut = h('button', { type: 'button', class: 'danger', onClick: () => { me = null; session = null; body = null; shownRoute = ''; safeSet(kv, 'me', null); void signer?.disconnect(); composer = review = result = null; flash = null; deps.setHash(''); draw() } }, t(lang, 'signOut'))
    const content: (HTMLElement | null)[] = !me ? [loginForm, signArea]
      : route.name === 'me' ? [accountCard(), installHint(deps.env ?? { ios: false, standalone: true }) ? h('section', { class: 'card install' }, h('h2', {}, t(lang, 'installTitle')), h('p', { class: 'meta' }, t(lang, 'installHint'))) : null, signArea, renderSettings({ settings, words, graph: session ? { ...session.graphInfo, loaded: session.graphInfo.graph.loaded } : null, onSettings: changeSettings, onWords: changeWords }, view()), h('h2', { class: 'section' }, t(lang, 'myNotes')), statusEl, body, h('p', { class: 'foot' }, signOut)]
      : [signArea, statusEl, body]
    const page: (HTMLElement | null)[] = [
      h('header', { class: 'top' }, updateReady ? h('div', { class: 'update', role: 'status' }, h('span', {}, t(lang, 'updateAvailable')), h('button', { type: 'button', class: 'primary', ...(busy ? { disabled: true } : {}), onClick: () => deps.reload?.() }, t(lang, 'updateNow'))) : null, h('h1', {}, h('a', { href: '#/' }, 'Quill')), h('span', { class: 'tag' }, t(lang, 'tagline')), me ? h('button', { type: 'button', class: 'icon', 'aria-label': t(lang, 'refresh'), title: t(lang, 'refresh'), onClick: refresh }, icon('refresh', 18)) : null, pills),
      h('main', { class: 'view' }, ...content),
      me ? h('nav', { class: 'tabbar' }, tab('following', '#/'), tab('mentions', '#/mentions'), tab('me', '#/me')) : null,
    ]
    root.replaceChildren(...page.filter((x): x is HTMLElement => x !== null))
  }

  deps.onHash(() => { void load() })
  // Coming back to the app after a while (an installed app stays alive in the background): show fresh notes, not what was there hours ago.
  deps.onVisible?.(() => { void checkUpdate(); if (me && !busy && (deps.nowMs?.() ?? Date.now()) - lastLoadAt > 120_000) refresh() })
  deps.onTick?.(() => { void checkUpdate() })
  void checkUpdate()
  draw()
  void load()
}
export type { Key }
