// The app: a login, two lists (following, mentions), a thread view, and — when a signer is configured — writing, replying and reacting through the
// user's remote signer. State lives here; everything else is a function of it.
import { nip19, type Event as NostrEvent } from 'nostr-tools'
import { canRepost, repostTemplate } from '../core/repost.js'
import { hashtagTags, mentionTags, mergeTags, quoteContent, quoteTags, reactionTags, replyTags } from '../core/compose.js'
import { parseIdentity } from '../core/identity.js'
import { mentionedKeys, shortNpub } from '../core/refs.js'
import { isReply } from '../core/thread.js'
import { judgeAll, tally, type Judged, type Settings } from '../core/verdict.js'
import { loadNetwork } from '../data/network.js'
import { loadProfile, type ProfileInfo } from '../data/profile.js'
import { followPubkeys, followTemplate, type FollowAction } from '../core/follow.js'
import { addBackup, checkBase, loadFollowList, nextKnown, parseBackups } from '../data/followlist.js'
import { loadFollowing, loadMentions, loadMine, loadNames, loadNote, loadThread, type Thread, type ThreadNode } from '../data/feed.js'
import { Engagement, loadEngagement, normReaction } from '../data/engaged.js'
import { countNew, groupReactions, groupReposts, loadActivity, mergeKnown, newFollowers, parseKnown, type Activity } from '../data/activity.js'
import { contextOf, loadSession, type Session } from '../data/session.js'
import { DEFAULT_RELAYS, memo, type Fetcher } from '../net/fetcher.js'
import { failedRelays, type Publisher } from '../net/publisher.js'
import { PipelineError, signAndPublish, type Published, type SignerApi, type Step } from '../sign/pipeline.js'
import { checkTemplate, MAX_NOTE_CHARS, type Template } from '../sign/policy.js'
import { h } from './dom.js'
import { logo, icon } from './icons.js'
import { detectLang, problemText, t, type Key, type Lang } from './i18n.js'
import { renderProfileHead, renderProfileMode, renderRepostGroups, renderFollowers, renderFeedMode, renderHelp, renderPrefs, renderReactionGroups, avatarEl, nameOf, renderJudged, renderList, renderSettings, renderSummary, renderTree, type View } from './render.js'
import { reactionBar, renderSignArea, type Composer, type Flash, type FollowPanel, type Review } from './sign-ui.js'
import { installHint, type Env } from './install.js'
import { parseAvatars, parseFeedMode, parseFont, parseLang, parseReposts, parseSettings, parseWords, safeGet, safeSet, type AvatarStyle, type FeedMode, type FontSize, type KV } from './store.js'
import { addRelay, parseRelays, removeRelay } from '../net/relays.js'
import { listState, loadPublishedRelays, relayListTemplate } from '../data/relaylist.js'

export interface Deps {
  fetcher: Fetcher; storage?: KV; languages?: readonly string[]; location: Pick<Location, 'hash'>; onHash: (cb: () => void) => void; setHash: (h: string) => void
  /** Without these the app is read-only. */
  signer?: SignerApi; publisher?: Publisher; relays?: string[]; copy?: (text: string) => void; nowMs?: () => number
  /** Reads the clipboard (needs a tap; may be refused). */
  readClipboard?: () => Promise<string>
  /** Facts about where the page runs (iPhone? installed?), and a hook for "the page came back to the foreground". */
  env?: Env; onVisible?: (cb: () => void) => void
  /** Is there a newer build of the app on the server? Asked at start, whenever the app comes back to the foreground and on every `onTick`. */
  /** Tells the code that talks to relays which list to use now (called at start and whenever the reader changes it). */
  setRelays?: (relays: string[]) => void; /** Does something answer at this address? */ probeRelay?: (url: string) => Promise<boolean>
  /** "Back" button: where the reader came from (the browser's history). */
  goBack?: () => void
  checkVersion?: () => Promise<boolean>; onTick?: (cb: () => void) => void; reload?: () => void
  /** How long the notices stay (tests make them short). */
  popupMs?: number; errorMs?: number
  /** Waits before each re-check of the follow list after publishing it (the relays take a moment to show it). */
  verifyWaitsMs?: number[]
  /** Called about once a minute while the page is visible: looks for new replies, mentions and reactions. */
  onPoll?: (cb: () => void) => void
}

type Route = { name: 'following' } | { name: 'mentions' } | { name: 'me' } | { name: 'settings'; focus?: 'filter' } | { name: 'help' } | { name: 'user'; pubkey: string } | { name: 'note'; id: string; from?: string }
export function parseRoute(hash: string): Route {
  const m = /^#\/note\/([^?]+)(?:\?from=([^&]*))?$/i.exec(hash)
  if (m) {
    const raw = m[1]!, from = /^[0-9a-f]{64}$/i.test(m[2] ?? '') ? m[2]!.toLowerCase() : undefined // the note this one was opened from (a quoted-note chip), if any
    const note = (id: string): Route => ({ name: 'note', id, ...(from && from !== id ? { from } : {}) })
    if (/^[0-9a-f]{64}$/i.test(raw)) return note(raw.toLowerCase())
    try {
      const d = nip19.decode(raw)
      if (d.type === 'note') return note(d.data)
      if (d.type === 'nevent') return note(d.data.id)
    } catch { /* not a note id */ }
  }
  const u = /^#\/user\/(.+)$/.exec(hash)
  if (u) { const r = parseIdentity(decodeURIComponent(u[1]!)); if (r.ok) return { name: 'user', pubkey: r.pubkey } } // an account: its key in hex, npub or nprofile
  return hash === '#/mentions' ? { name: 'mentions' } : hash === '#/me' ? { name: 'me' } : hash === '#/help' ? { name: 'help' } : hash === '#/settings' ? { name: 'settings' } : hash === '#/settings/filter' ? { name: 'settings', focus: 'filter' } : { name: 'following' }
}

export function startApp(root: HTMLElement, deps: Deps): void {
  const fetcher = memo(deps.fetcher)
  const kv = deps.storage
  const { signer, publisher } = deps
  const defaultRelays = deps.relays ?? DEFAULT_RELAYS
  let relays = parseRelays(safeGet(kv, 'relays')) ?? defaultRelays
  let font: FontSize = parseFont(safeGet(kv, 'font'))
  let showReposts = parseReposts(safeGet(kv, 'reposts'))
  let profileMode: 'notes' | 'replies' = 'notes' // what an account's page shows
  let avatarStyle: AvatarStyle = parseAvatars(safeGet(kv, 'avatars'))
  let feedMode: FeedMode = parseFeedMode(safeGet(kv, 'feed'))
  let relayError: string | null = null
  const probes = new Map<string, 'testing' | 'up' | 'down'>()
  let published: string[] | null | undefined // the relay list on Nostr: undefined = not read (yet), null = none
  let confirmingList = false
  let confirmingDisconnect = false
  // following: the list as the reader was seen to have it (a new list is refused if the one found lacks many of these), and the panel in progress
  const followingKey = () => `following:${me}`
  let knownFollowing: Set<string> | null = null
  const loadKnownFollowing = () => { knownFollowing ??= parseKnown(safeGet(kv, followingKey())); return knownFollowing }
  const saveKnownFollowing = (s: Set<string>) => { knownFollowing = s; safeSet(kv, followingKey(), JSON.stringify([...s])) }
  type FollowFlow = { stage: 'checking'; pubkey: string; action: FollowAction } | { stage: 'confirm'; pubkey: string; action: FollowAction; base: NostrEvent; changed: boolean } | { stage: 'refuse'; pubkey: string; action: FollowAction; why: 'none' | 'shrunk'; known: number; found: number; base: NostrEvent | null }
  let followFlow: FollowFlow | null = null
  let shareConfirm: NostrEvent | null = null // the note about to be shared (sharing asks first: it is public)
  const shareable = new Set<string>() // ids of the notes whose bar offers Share (visible to the filter, shareable)
  const helpOpen = new Set<string>(['about']) // which Help sections are unfolded
  let adoptTried = false // the published list becomes this device's list at most once per page load, and only if the reader never chose one here
  deps.setRelays?.(relays)
  const applyFont = () => root.ownerDocument.documentElement.setAttribute('data-font', font)
  applyFont()
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
  let engagement = new Engagement() // what the reader already did to each note
  let scrollToTop = false // set when a different view is shown
  let updateReady = false
  // activity around my notes: what is new since the last time the Mentions tab was open
  const seenKey = () => `seen:${me}`
  let seenAt: number | null = null // unix seconds of the last visit to Mentions
  let markFrom: number | null = null // while Mentions is open: notes newer than this are marked as new
  let badge = 0
  // followers: the ones ever seen (it only grows: relays each return only part of them), and, while Mentions is open, the set as it was when it was opened
  const followersKey = () => `followers:${me}`
  let knownFollowers: Set<string> | null = null
  let followersMark: ReadonlySet<string> | null = null
  const loadKnown = () => { knownFollowers ??= parseKnown(safeGet(kv, followersKey())); return knownFollowers }
  const saveKnown = (s: Set<string>) => { knownFollowers = s; safeSet(kv, followersKey(), JSON.stringify([...s])) }
  /** Switching account: nothing remembered about the notifications of the previous one may leak into the next. */
  // the newest list of every known follower is checked now and then (not at every look): that is how somebody who stopped following is noticed
  const VERIFY_EVERY_MS = 30 * 60_000
  let lastVerify = 0
  const activityOptions = () => ({ known: loadKnown() ?? undefined, verifyKnown: lastVerify === 0 || (deps.nowMs?.() ?? Date.now()) - lastVerify > VERIFY_EVERY_MS })
  /** Who stopped following is forgotten (they count again as new if they come back), and the check is remembered. */
  const afterActivity = (a: Activity, verified: boolean) => {
    if (verified) lastVerify = deps.nowMs?.() ?? Date.now()
    if (!a.gone.length) return
    const gone = new Set(a.gone)
    for (const k of gone) followersSeen.delete(k)
    if (knownFollowers) saveKnown(new Set([...knownFollowers].filter((k) => !gone.has(k))))
  }
  const followersSeen = new Set<string>() // everybody seen following you since this page opened (the known ones are in `knownFollowers`)
  /** How many accounts have been seen following the reader: only a lower bound (each relay knows part of them), and it only grows. Null while nothing has been looked at yet. */
  const followerCount = (): number | null => { const k = loadKnown(); return k === null && followersSeen.size === 0 ? null : new Set([...(k ?? []), ...followersSeen]).size }
  const forgetAccount = () => { followFlow = null; knownFollowing = null; shareConfirm = null; lastVerify = 0; seenAt = null; markFrom = null; badge = 0; knownFollowers = null; followersMark = null; followersSeen.clear() }
  const nowSec = () => Math.floor((deps.nowMs?.() ?? Date.now()) / 1000)
  const loadSeen = () => { const n = Number(safeGet(kv, seenKey())); seenAt = Number.isInteger(n) && n > 0 ? n : null }
  const markSeen = () => { seenAt = nowSec(); safeSet(kv, seenKey(), String(seenAt)); badge = 0 }

  const barFor = (e: NostrEvent) => reactionBar(e, (emoji) => void react(e, emoji), () => startReply(e), view(), engagement.of(e.id), shareable.has(e.id) ? () => startShare(e) : undefined)
  const actions = (j: Judged) => {
    if (signer?.state !== 'connected') return []
    // a note the filter hides is not amplified from here, and only text notes of a reasonable size can be shared
    if (!j.verdict.hidden && canRepost(j.event)) shareable.add(j.event.id); else shareable.delete(j.event.id)
    return [barFor(j.event)]
  }
  /** The lists are built once and reused between redraws, so a bar already on screen keeps what it showed: redo the bar(s) of this note in place. */
  const rebar = (e: NostrEvent) => { for (const old of root.querySelectorAll(`article.note[data-id="${e.id}"] .actions`)) old.replaceWith(barFor(e)) }
  const view = (): View => ({ lang, names, actions: signer ? actions : undefined, nowMs: deps.nowMs?.(), avatars: avatarStyle, copy: (x) => deps.copy?.(x), ...(markFrom !== null ? { isNew: (e: NostrEvent) => e.created_at > markFrom! } : {}) })
  const ctx = () => contextOf(session!, { mutedWords: words, mutedKeys: [] })
  const who = () => (signer?.pubkey ? nameOf(view(), signer.pubkey) : '')

  // Loading what the reader's account needs (follows, mutes, what they already did, their published relay list) takes a few round trips, and several loads can
  // start while it runs (the saved signer session resuming starts one). So there is ONE load in flight that all of them wait for, and `session` is only ever
  // set once everything is ready: nobody can see it half-built or emptied.
  let ensuring: Promise<boolean> | null = null
  function ensureSession(): Promise<boolean> {
    if (session || !me) return Promise.resolve(!!session)
    return (ensuring ??= loadAccount().finally(() => { ensuring = null }))
  }
  async function loadAccount(): Promise<boolean> {
    const who = me!
    status = t(lang, 'loadingFollows'); draw()
    const fetchAll = async () => {
      const s = await loadSession(fetcher, who)
      return { s, e: await loadEngagement(fetcher, who).catch(() => new Engagement()), p: await loadPublishedRelays(fetcher, who).catch(() => undefined) } // a failure only means nothing is marked / unknown
    }
    let got: Awaited<ReturnType<typeof fetchAll>>
    try {
      got = await fetchAll()
      if (!adoptTried) {
        adoptTried = true
        if (got.p && safeGet(kv, 'relays') === null && !sameList(got.p, relays)) { // a new device: start from the list the reader published
          relays = got.p; safeSet(kv, 'relays', JSON.stringify(relays)); deps.setRelays?.(relays); fetcher.clear(); say('info', t(lang, 'listAdopted', { n: relays.length })) // from now on it is this device's own list: the notice shows once
          got = await fetchAll()
        }
      }
    } catch { status = null; return false }
    if (me !== who) return false // signed out or switched while loading
    session = got.s; engagement = got.e; published = got.p
    saveKnownFollowing(nextKnown(loadKnownFollowing(), got.s.follows)) // what the reader follows, as far as it is trusted
    return true
  }

  async function nameThem(items: Judged[], extra: string[] = []): Promise<void> {
    const keys = [...extra, ...items.flatMap((j) => [j.event.pubkey, ...(j.repostedBy ?? []), ...(j.followedBy ?? []).slice(0, 1), ...mentionedKeys(j.event.content)]), ...(signer?.pubkey ? [signer.pubkey] : [])].filter((k) => !names.has(k))
    if (!keys.length) return
    for (const [k, n] of await loadNames(fetcher, keys)) names.set(k, n)
  }

  async function load(): Promise<void> {
    const mine = ++run
    if (!me) return draw()
    if (!(await ensureSession()) || mine !== run || !session) return
    const route = parseRoute(deps.location.hash)
    const key = JSON.stringify(route)
    if (key !== shownRoute) { body = null; shownRoute = key; scrollToTop = true; profileMode = 'notes'; if (route.name !== 'mentions') { markFrom = null; followersMark = null } }
    if (route.name === 'settings' || route.name === 'help') { status = null; body = null; draw(); return }
    status = t(lang, 'loadingFeed'); draw()
    let content: HTMLElement
    try {
      if (route.name === 'note') {
        const [th, source] = await Promise.all([loadThread(fetcher, route.id, ctx(), settings), route.from ? loadNote(fetcher, route.from, ctx(), settings).catch(() => null) : Promise.resolve(null)])
        if (mine !== run) return
        if (!th) content = h('div', { class: 'stack' }, sourceCard(source), h('p', { class: 'empty' }, t(lang, 'noNote')))
        else { await nameThem([...(th.root ? [th.root] : []), ...flat(th.replies), ...(source ? [source] : [])]); content = threadView(th, source) }
      } else if (route.name === 'user') {
        const { info, notes } = await loadProfile(fetcher, route.pubkey, session!, ctx(), settings)
        if (mine !== run) return
        await nameThem(notes, [info.pubkey, ...info.via.slice(0, 3)]); content = profileView(info, notes)
      } else {
        let act: Activity | null = null
        if (route.name === 'mentions') {
          if (seenAt === null) loadSeen()
          const opts = activityOptions(); act = await loadActivity(fetcher, ctx(), settings, opts); afterActivity(act, !!opts.verifyKnown)
        }
        const items = act ? act.notes : route.name === 'me' ? await loadMine(fetcher, ctx(), settings) : (feedMode === 'network' ? await loadNetwork(fetcher, session!, ctx(), settings) : await loadFollowing(fetcher, ctx(), settings, { reposts: showReposts }))
        if (mine !== run) return
        // the first visit to Mentions ever takes the followers of today as its starting point (nothing is "new" yet); later, the ones not seen before are
        const baseline = act ? (loadKnown() ?? new Set(act.followers)) : null
        if (act) for (const k of act.followers) followersSeen.add(k)
        if (act && followersMark === null) followersMark = baseline
        const fresher = act ? newFollowers(act, followersMark!) : []
        await nameThem(act ? [...items, ...act.reactions, ...act.reposts] : items, fresher.slice(0, 8))
        if (route.name === 'me' && !names.has(me)) for (const [k, n] of await loadNames(fetcher, [me])) names.set(k, n)
        if (act) {
          if (markFrom === null) markFrom = seenAt ?? nowSec() // first ever visit: nothing is "new"
          const fresh = countNew(act, markFrom, followersMark!)
          markSeen(); saveKnown(mergeKnown(baseline!, act))
          const block = renderReactionGroups(groupReactions(act, markFrom), view())
          const line = fresh.shown || fresh.hidden ? h('p', { class: 'meta new-line', role: 'status' }, [fresh.shown ? t(lang, 'newItems', { n: fresh.shown }) : '', fresh.hidden ? t(lang, 'newHidden', { n: fresh.hidden }) : ''].filter(Boolean).join(' · ')) : null
          content = h('div', { class: 'stack' }, renderSummary(tally(items), view(), toggleSettings), line, renderFollowers(fresher, view()), block, renderRepostGroups(groupReposts(act, markFrom), view()), renderList(items, view()))
        } else if (route.name === 'me') content = renderList(items, view())
        else {
          // Following: the people you follow, or the network; in the network an empty list says why (no follow lists arrived, or just nothing new)
          const network = route.name === 'following' && feedMode === 'network'
          const empty = network && !items.length ? h('p', { class: 'empty' }, t(lang, session!.graphInfo.answered === 0 ? 'networkNotLoaded' : 'networkEmpty')) : null
          content = h('div', { class: 'stack' }, route.name === 'following' ? renderFeedMode(feedMode, changeFeedMode, view()) : null, renderSummary(tally(items), view(), toggleSettings), empty ?? renderList(items, view()))
        }
      }
    } catch { content = h('p', { class: 'empty' }, t(lang, 'noNote')) }
    if (mine !== run) return
    status = null; body = content; lastLoadAt = deps.nowMs?.() ?? Date.now(); draw()
    if (route.name !== 'mentions') void poll()
  }

  /** Looks for what is new around my notes since the last visit to Mentions and shows how many things the filter lets through as a number on the tab. */
  async function poll(): Promise<void> {
    if (!me || !session || parseRoute(deps.location.hash).name === 'mentions') return
    if (seenAt === null) loadSeen()
    try {
      fetcher.clear()
      const opts = activityOptions(), a = await loadActivity(fetcher, ctx(), settings, opts)
      const before = followerCount()
      afterActivity(a, !!opts.verifyKnown)
      if (loadKnown() === null) saveKnown(new Set(a.followers)) // the first look at followers only learns who they are
      for (const k of a.followers) followersSeen.add(k)
      if (seenAt === null) { markSeen(); draw(); return } // first run: start counting from now, do not greet with a pile
      const n = countNew(a, seenAt, knownFollowers!).shown
      if (n !== badge || followerCount() !== before) { badge = n; draw() }
    } catch { /* a failed look says nothing */ }
  }

  async function checkUpdate(): Promise<void> {
    if (!deps.checkVersion || updateReady) return
    try { if (await deps.checkVersion()) { updateReady = true; draw() } } catch { /* a failed check says nothing */ }
  }

  /** Reads everything again from the relays (an installed app has no pull-to-refresh). */
  function refresh(): void { fetcher.clear(); session = null; void load() }

  const flat = (nodes: ThreadNode[]): Judged[] => nodes.flatMap((n) => [n.item, ...flat(n.children)])

  /** Where you came from: the note whose "Quoted note" button was tapped. */
  function sourceCard(source: Judged | null): HTMLElement | null {
    return source ? h('section', { class: 'quoted-from' }, h('p', { class: 'meta' }, t(lang, 'quotedFrom')), renderJudged(source, view())) : null
  }
  /** What the sign area shows of a follow / unfollow in progress. */
  function followPanel(): FollowPanel | null {
    const f = followFlow
    if (!f) return null
    if (f.stage === 'checking') return { stage: 'checking' }
    if (f.stage === 'refuse') return { stage: 'refuse', why: f.why, known: f.known, found: f.found }
    const before = followPubkeys(f.base).length
    return { stage: 'confirm', who: nameOf(view(), f.pubkey), action: f.action, before, after: before + (f.action === 'follow' ? 1 : -1), changed: f.changed }
  }

  /** "Back": to where you came from (the browser's history), or to the start when there is none. */
  const backLink = () => h('a', { class: 'back', href: '#/', onClick: (e: Event) => { e.preventDefault(); if (deps.goBack) deps.goBack(); else deps.setHash('') } }, icon('back', 16), t(lang, 'back'))

  /** The page of an account: its profile as text, how it relates to you, and its notes (or replies). */
  function profileView(info: ProfileInfo, notes: Judged[]): HTMLElement {
    const relation = info.pubkey === me ? 'you' : session!.muted.has(info.pubkey) ? 'muted' : session!.follows.has(info.pubkey) ? 'follow' : 'none'
    const shown = notes.filter((n) => isReply(n.event) === (profileMode === 'replies'))
    const canFollow = signer?.state === 'connected' && info.pubkey !== me
    return h('div', { class: 'stack' }, backLink(), renderProfileHead(info, relation, view(), canFollow ? { following: relation === 'follow', busy: !!followFlow || busy, onToggle: () => void startFollow(info.pubkey, relation === 'follow' ? 'unfollow' : 'follow') } : undefined), renderProfileMode(profileMode, (m) => { profileMode = m; void load() }, view()),
      shown.length ? renderSummary(tally(shown), view(), toggleSettings) : null, shown.length ? renderList(shown, view()) : h('p', { class: 'empty' }, t(lang, 'profileEmpty')))
  }

  function threadView(th: Thread, source: Judged | null = null): HTMLElement {
    const all = [...(th.root ? [th.root] : []), ...flat(th.replies)]
    return h('div', { class: 'stack' },
      backLink(),
      sourceCard(source),
      renderSummary(tally(all), view(), toggleSettings),
      th.root ? renderJudged(th.root, view()) : null,
      h('h3', {}, `${th.total} ${t(lang, 'replies')}`),
      ...renderTree(th.replies, view()),
    )
  }

  function toggleSettings(): void { deps.setHash('#/settings/filter') } // the filter settings live in Settings
  function changeSettings(s: Settings): void { settings = s; safeSet(kv, 'settings', JSON.stringify(s)); void load() }
  function changeFeedMode(m: FeedMode): void { feedMode = m; safeSet(kv, 'feed', m === 'follows' ? null : m); void load() }
  function changeAvatars(a: AvatarStyle): void { avatarStyle = a; safeSet(kv, 'avatars', a === 'initials' ? null : a); void load() } // the cards are built once and kept: they are rebuilt with the new pictures
  function changeReposts(on: boolean): void { showReposts = on; safeSet(kv, 'reposts', on ? null : '0'); void load() }
  function changeFont(f: FontSize): void { font = f; safeSet(kv, 'font', f); applyFont(); draw() }
  /** A new relay list: stored, handed to the network code, and everything is read again from it. */
  function changeRelays(list: string[]): void {
    relays = list; relayError = null; probes.clear()
    safeSet(kv, 'relays', JSON.stringify(list)); deps.setRelays?.(list); refresh()
  }
  const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])
  /** Publishing the list is a public act: first a confirmation that says so, then the signer. */
  async function publishList(): Promise<void> {
    confirmingList = false
    if (!signer || signer.state !== 'connected') return draw()
    const template = relayListTemplate(relays, Math.floor((deps.nowMs?.() ?? Date.now()) / 1000))
    const problem = checkTemplate(template)
    if (problem) { say('error', problemText(lang, problem)); return draw() }
    if (await send(template)) { published = [...relays]; if (result && !failedRelays(result.outcomes).length) { result = null; say('info', t(lang, 'listDone')) } }
    draw()
  }
  function onAddRelay(text: string): void {
    const r = addRelay(relays, text)
    if (!r.ok) { relayError = t(lang, r.why === 'invalid' ? 'relayBad' : r.why === 'duplicate' ? 'relayDup' : 'relayFull'); return draw() }
    changeRelays(r.list)
  }
  function onTestRelay(url: string): void {
    if (!deps.probeRelay) return
    probes.set(url, 'testing'); draw()
    void deps.probeRelay(url).then((ok) => { if (relays.includes(url)) { probes.set(url, ok ? 'up' : 'down'); draw() } })
  }
  function changeWords(text: string): void { words = parseWords(text); safeSet(kv, 'words', words.join('\n')); void load() }

  function login(raw: string): void {
    const r = parseIdentity(raw)
    if (!r.ok) { loginError = t(lang, 'loginBad'); return draw() }
    me = r.pubkey; loginError = null; session = null; body = null; shownRoute = ''; forgetAccount()
    safeSet(kv, 'me', me)
    void load()
  }

  // ---- signing ----
  const POPUP_MS = deps.popupMs ?? 3000
  const ERROR_MS = deps.errorMs ?? 12_000 // long enough to read, but a message must not stay fixed at the bottom of the screen for ever
  const say = (kind: Flash['kind'], text: string, ms?: number) => {
    const mine = flash = { kind, text }
    setTimeout(() => { if (flash === mine) { flash = null; draw() } }, ms ?? (kind === 'info' ? POPUP_MS : ERROR_MS))
  }

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

  async function send(template: Template, opts: { followBase?: NostrEvent } = {}): Promise<boolean> {
    if (!signer || !publisher) return false
    // Still waiting for the signer to answer an earlier tap (e.g. Clave was closed): a new tap replaces it, so opening Clave and tapping again works.
    // Once the signature is made and the event is being sent, a second tap is ignored (no double posts).
    if (busy && step === 'waiting') { signing?.abort(); await current?.catch(() => {}) } else if (busy) return false
    busy = true; flash = null; result = null; const mine = signing = new AbortController(); draw()
    current = (async () => {
      try {
        result = await signAndPublish({ signer, publisher, kv, now: deps.nowMs, signal: mine.signal, followBase: opts.followBase }, template, (s) => { step = s; draw() })
        step = null; fetcher.clear()
        return true
      } catch (e) { step = null; if (!(mine.signal.aborted && signing !== mine)) sayPipelineError(e); return false } finally { if (signing === mine) { busy = false; signing = null } draw() }
    })()
    return current
  }

  function templateFor(text: string, target?: NostrEvent, mode: Composer['mode'] = target ? 'reply' : 'note'): Template {
    const auto = mergeTags(mentionTags(text), hashtagTags(text))
    const created_at = Math.floor((deps.nowMs?.() ?? Date.now()) / 1000)
    // a quote is a note of its own (not a reply): the comment, then a reference to the quoted note, with the q tag that points at it
    if (mode === 'quote' && target) { const hint = relays[0] ?? ''; return { kind: 1, content: quoteContent(text, target, hint), tags: mergeTags(quoteTags(target, hint), auto), created_at } }
    return { kind: 1, content: text, tags: target ? mergeTags(replyTags(target), auto) : auto, created_at }
  }

  function startReply(target: NostrEvent): void { composer = { mode: 'reply', target, text: '' }; review = null; result = null; flash = null; draw(); root.querySelector('textarea')?.focus() }
  /** From the share panel: a quote asks for the reader's comment first. */
  function startQuote(target: NostrEvent): void { shareConfirm = null; composer = { mode: 'quote', target, text: '' }; review = null; result = null; flash = null; draw(); root.querySelector('textarea')?.focus() }
  function startNote(): void { composer = { mode: 'note', text: '' }; draw(); root.querySelector('textarea')?.focus() }
  function doReview(): void {
    if (!composer) return
    let template: Template
    if (composer.mode === 'quote' && !composer.text.trim()) { say('error', t(lang, 'quoteEmpty')); return draw() }
    try { template = templateFor(composer.text, composer.target, composer.mode) } catch { return say('error', t(lang, 'p_tags')), draw() }
    const problem = checkTemplate(template)
    if (problem) { say('error', problemText(lang, problem, { max: MAX_NOTE_CHARS })); return draw() }
    flash = null; review = { template, target: composer.target, mentions: template.tags.filter((x) => x[0] === 'p').length, quote: composer.mode === 'quote' }; draw()
  }
  async function publish(): Promise<void> {
    if (!review) return
    const replyingTo = review.quote ? undefined : review.target, ok = await send(review.template) // a quote is not a reply: the note quoted is not marked as answered
    if (ok) { if (replyingTo) { engagement.addReply(replyingTo.id); rebar(replyingTo) } review = null; composer = null; void load() }
  }
  async function react(target: NostrEvent, emoji: string): Promise<void> {
    const template: Template = { kind: 7, content: emoji, tags: reactionTags(target), created_at: Math.floor((deps.nowMs?.() ?? Date.now()) / 1000) }
    const problem = checkTemplate(template)
    if (problem) { say('error', problemText(lang, problem)); return draw() }
    // the same reaction twice would only be a duplicate post: say so instead of asking the signer again
    if (engagement.of(target.id).reactions.has(normReaction(emoji))) { say('info', t(lang, 'alreadyReacted', { emoji: emoji === '+' ? '👍' : emoji })); return draw() }
    if (await send(template)) {
      engagement.addReaction(target.id, emoji); rebar(target)
      // A like that reached every relay needs one quiet line that fades, not the per-relay panel. If some relay failed, the panel stays (it has the retry).
      if (result && !failedRelays(result.outcomes).length) {
        result = null; say('info', `${emoji === '+' ? '👍' : emoji} → ${nameOf(view(), target.pubkey)}`)
      }
    }
    draw()
  }
  const sameFollows = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((k) => b.has(k))
  /** Following or unfollowing: read the newest list NOW, check it looks like the list the reader has been seen to have, and show exactly what will change. */
  async function startFollow(pubkey: string, action: FollowAction): Promise<void> {
    if (!signer || signer.state !== 'connected' || busy || !me || pubkey === me) return
    followFlow = { stage: 'checking', pubkey, action }; draw()
    fetcher.clear()
    let base: NostrEvent | null = null
    try { base = await loadFollowList(fetcher, me) } catch { base = null }
    if (!followFlow || followFlow.stage !== 'checking') return // cancelled meanwhile
    const verdict = checkBase(base, loadKnownFollowing())
    if (!verdict.ok) { followFlow = { stage: 'refuse', pubkey, action, why: verdict.why, known: verdict.known, found: verdict.found, base }; return draw() }
    if (!followTemplate(base!, pubkey, action, nowSec())) { followFlow = null; say('info', t(lang, action === 'follow' ? 'profileFollowed' : 'profileNotFollowed')); return draw() } // already so
    followFlow = { stage: 'confirm', pubkey, action, base: base!, changed: false }; draw()
  }
  /** The reader says the list they have now is the right one (they removed many accounts on purpose): it becomes the reference, and the change goes on. */
  function acceptList(): void {
    const f = followFlow
    if (!f || f.stage !== 'refuse' || !f.base) return
    saveKnownFollowing(new Set(followPubkeys(f.base))); void startFollow(f.pubkey, f.action)
  }
  async function confirmFollow(): Promise<void> {
    const f = followFlow
    if (!f || f.stage !== 'confirm' || !me || !signer || signer.state !== 'connected') return
    // the list is read AGAIN right before signing: if it changed meanwhile (another app), the reader sees the new numbers and confirms again
    fetcher.clear()
    let fresh: NostrEvent | null = null
    try { fresh = await loadFollowList(fetcher, me) } catch { fresh = null }
    if (!followFlow || followFlow.stage !== 'confirm') return
    const verdict = checkBase(fresh, loadKnownFollowing())
    if (!verdict.ok) { followFlow = { stage: 'refuse', pubkey: f.pubkey, action: f.action, why: verdict.why, known: verdict.known, found: verdict.found, base: fresh }; return draw() }
    if (fresh!.id !== f.base.id) { followFlow = { ...f, base: fresh!, changed: true }; return draw() }
    const template = followTemplate(fresh!, f.pubkey, f.action, nowSec())
    const problem = template ? checkTemplate(template, { followBase: fresh! }) : 'follow'
    if (!template || problem) { followFlow = null; say('error', problemText(lang, problem ?? 'follow')); return draw() }
    followFlow = null
    safeSet(kv, `followbackup:${me}`, JSON.stringify(addBackup(parseBackups(safeGet(kv, `followbackup:${me}`)), fresh!))) // a copy of the list as it was, kept on this device
    if (await send(template, { followBase: fresh! })) {
      const next = new Set(followPubkeys({ tags: template.tags })); session!.follows = next; saveKnownFollowing(next)
      const name = nameOf(view(), f.pubkey)
      // the relays take a moment to show a new list: look again a couple of times before saying they do not
      let confirmed = false
      for (const wait of deps.verifyWaitsMs ?? [1500, 3000]) {
        await new Promise((r) => setTimeout(r, wait))
        try { fetcher.clear(); const after = await loadFollowList(fetcher, me); confirmed = !!after && sameFollows(new Set(followPubkeys(after)), next) } catch { confirmed = false }
        if (confirmed) break
      }
      if (result && !failedRelays(result.outcomes).length) result = null
      say('info', confirmed ? t(lang, f.action === 'follow' ? 'followDone' : 'unfollowDone', { who: name }) : t(lang, 'followUnconfirmed'), confirmed ? undefined : 7000)
      draw(); void load() // the feed and the counts follow the new list
      return
    }
    draw()
  }

  /** Sharing is public: first a confirmation that shows the note, then the signature. */
  function startShare(target: NostrEvent): void {
    if (engagement.of(target.id).reposted) { say('info', t(lang, 'alreadyShared')); return draw() }
    shareConfirm = target; draw()
  }
  async function share(): Promise<void> {
    const target = shareConfirm; shareConfirm = null
    if (!target || !signer || signer.state !== 'connected') return draw()
    const template = repostTemplate(target, relays[0] ?? '', Math.floor((deps.nowMs?.() ?? Date.now()) / 1000))
    const problem = checkTemplate(template)
    if (problem) { say('error', problemText(lang, problem)); return draw() }
    if (await send(template)) {
      engagement.addRepost(target.id); rebar(target)
      if (result && !failedRelays(result.outcomes).length) { result = null; say('info', t(lang, 'shareDone', { who: nameOf(view(), target.pubkey) })) }
    }
    draw()
  }
  async function retry(): Promise<void> {
    if (!result || !publisher || busy) return
    busy = true; step = 'sending'; draw()
    try { const again = await publisher.publish(result.event, failedRelays(result.outcomes)); result = { event: result.event, outcomes: { ...result.outcomes, ...again } } } finally { busy = false; step = null; draw() }
  }

  /** "128 following · ~37 followers": the first is exact (it is your own list), the second is approximate (what the relays showed; there is no official count and every app counts its own way). */
  function countsLine(): HTMLElement | null {
    if (!session) return null
    const n = followerCount()
    const followers = n === null ? null : n === 0 ? t(lang, 'followersNone') : t(lang, n === 1 ? 'followersAtLeastOne' : 'followersAtLeast', { n })
    return h('div', { class: 'meta counts' }, [t(lang, 'followingN', { n: session.follows.size }), followers].filter(Boolean).join(' · '))
  }

  function accountCard(): HTMLElement {
    return h('section', { class: 'account card' }, avatarEl(me!, view(), 'lg'),
      h('div', {}, h('strong', {}, nameOf(view(), me!)), h('div', { class: 'meta' }, shortNpub(me!)), countsLine()))
  }

  function draw(): void {
    // <main> is the only thing that scrolls and it is rebuilt on every draw. Read where the reader was FIRST: building the new one moves the list out of
    // the old one, which then collapses to zero.
    const kept = root.querySelector('main.view')?.scrollTop ?? 0
    const route = parseRoute(deps.location.hash)
    if (confirmingDisconnect && (route.name !== 'me' || signer?.state !== 'connected')) confirmingDisconnect = false // a question left behind is forgotten
    if (shareConfirm && signer?.state !== 'connected') shareConfirm = null
    if (followFlow && signer?.state !== 'connected') followFlow = null
    const tab = (name: 'following' | 'mentions' | 'me', href: string) => h('a', { href, class: route.name === name ? 'tab on' : 'tab', 'data-tab': name, ...(route.name === name ? { 'aria-current': 'page' } : {}), onClick: (e: Event) => { if (route.name === name) { e.preventDefault(); refresh() } } }, icon(name === 'following' ? 'people' : name === 'mentions' ? 'at' : 'person', 18), t(lang, name), name === 'mentions' && badge > 0 ? h('span', { class: 'badge', role: 'status', 'aria-label': t(lang, 'newItems', { n: badge }) }, badge > 9 ? '9+' : String(badge)) : null)
    const input = h('input', { type: 'text', placeholder: t(lang, 'loginPlaceholder'), autocomplete: 'off', spellcheck: 'false', 'aria-label': t(lang, 'loginTitle') })
    const loginForm = h('form', { class: 'login card', onSubmit: (e: Event) => { e.preventDefault(); login(input.value) } },
      h('p', { class: 'tagline' }, t(lang, 'tagline')), h('h2', {}, t(lang, 'loginTitle')), h('p', {}, t(lang, 'loginHelp')), input, ' ', h('button', { type: 'submit', class: 'primary' }, t(lang, 'loginButton')),
      loginError ? h('p', { class: 'error', role: 'alert' }, loginError) : null)
    const signArea = signer ? renderSignArea({
      signer: signer.state, who: who() || (signer.pubkey ? shortNpub(signer.pubkey) : null), connect, connectOpen, flash, composer, review, step, result, relays, bunkerText, linkOpen, confirmDisconnect: confirmingDisconnect, shareConfirm, followPanel: followPanel(),
    }, {
      openConnect, startLink, pasteBunker: () => void pasteBunker(), cancelConnect, bunker: (x) => void bunker(x), dismissFlash: () => { flash = null; draw() }, confirmFollow: () => void confirmFollow(), acceptList, cancelFollow: () => { followFlow = null; draw() }, confirmShare: () => void share(), startQuote: () => { if (shareConfirm) startQuote(shareConfirm) }, cancelShare: () => { shareConfirm = null; draw() }, askDisconnect: () => { confirmingDisconnect = true; draw() }, cancelDisconnect: () => { confirmingDisconnect = false; draw() },
      disconnect: () => { confirmingDisconnect = false; void signer.disconnect(); composer = review = result = null; flash = null; draw() }, copy: (x) => { deps.copy?.(x); say('info', t(lang, 'copied')); draw() },
      edit: (x) => { if (composer) composer.text = x }, review: doReview, publish: () => void publish(), back: () => { review = null; draw() }, cancelComposer: () => { composer = null; review = null; draw() },
      retry: () => void retry(), dismissResult: () => { result = null; draw() }, startNote, cancelSigning: () => signing?.abort(),
      editBunker: (x) => { bunkerText = x }, setLinkOpen: (o) => { linkOpen = o },
    }, view(), true, !me || route.name === 'me' ? 'me' : 'feed', !!me && ['following', 'mentions', 'note', 'user', 'me'].includes(route.name)) : null
    const pills = h('div', { class: 'lang', role: 'group', 'aria-label': 'Language' }, ...(['en', 'es'] as const).map((l) =>
      h('button', { type: 'button', 'aria-pressed': String(lang === l), onClick: () => { if (lang !== l) { lang = l; safeSet(kv, 'lang', lang); void load() } } }, l.toUpperCase())))
    const statusEl = me && status ? h('p', { class: 'status loading', role: 'status' }, h('span', {}, status)) : null
    const signOut = h('button', { type: 'button', class: 'danger', onClick: () => { me = null; session = null; body = null; shownRoute = ''; forgetAccount(); safeSet(kv, 'me', null); void signer?.disconnect(); composer = review = result = null; flash = null; deps.setHash(''); draw() } }, t(lang, 'signOut'))
    const helpPage = renderHelp(view(), helpOpen, (id, isOpen) => { if (isOpen) helpOpen.add(id); else helpOpen.delete(id) })
    const content: (HTMLElement | null)[] = route.name === 'help' ? [signArea, helpPage]
      : !me ? [loginForm, signArea]
      : route.name === 'settings' ? [signArea, renderPrefs({ font, avatars: avatarStyle, sampleKey: me!, onAvatars: changeAvatars, reposts: showReposts, onReposts: changeReposts, relays, isDefault: sameList(relays, defaultRelays), error: relayError, probe: probes, onFont: changeFont, onAdd: onAddRelay, onRemove: (u) => changeRelays(removeRelay(relays, u)), onTest: onTestRelay, onReset: () => changeRelays(defaultRelays),
        list: { state: listState(published, relays), publishedCount: published?.length ?? 0, canSign: signer?.state === 'connected', confirming: confirmingList },
        onAskPublish: () => { confirmingList = true; draw() }, onCancelPublish: () => { confirmingList = false; draw() }, onPublish: () => void publishList(), onUsePublished: () => { if (published) changeRelays(published) } }, view()), renderSettings({ settings, words, graph: session ? { ...session.graphInfo, loaded: session.graphInfo.graph.loaded } : null, onSettings: changeSettings, onWords: changeWords }, view())]
      : route.name === 'me' ? [accountCard(), installHint(deps.env ?? { ios: false, standalone: true }) ? h('section', { class: 'card install' }, h('h2', {}, t(lang, 'installTitle')), h('p', { class: 'meta' }, t(lang, 'installHint'))) : null, signArea, h('h2', { class: 'section' }, t(lang, 'myNotes')), body, h('p', { class: 'foot' }, signOut)]
      : [signArea, body]
    const page: (HTMLElement | null)[] = [
      h('header', { class: 'top' }, updateReady ? h('div', { class: 'update', role: 'status' }, h('span', {}, t(lang, 'updateAvailable')), h('button', { type: 'button', class: 'primary', ...(busy ? { disabled: true } : {}), onClick: () => deps.reload?.() }, t(lang, 'updateNow'))) : null, h('div', { class: 'brand' }, h('h1', {}, h('a', { href: '#/', class: 'wordmark' }, logo(26), 'Quill')), h('span', { class: 'tag' }, t(lang, 'tagline'))), me ? h('button', { type: 'button', class: status ? 'icon spinning' : 'icon', 'aria-label': t(lang, 'refresh'), title: t(lang, 'refresh'), ...(status ? { 'aria-busy': 'true' } : {}), onClick: refresh }, icon('refresh', 18)) : null, pills, me ? h('button', { type: 'button', class: route.name === 'settings' ? 'icon on' : 'icon', 'aria-label': t(lang, 'prefsTitle'), title: t(lang, 'prefsTitle'), 'aria-pressed': String(route.name === 'settings'), onClick: () => deps.setHash(route.name === 'settings' ? '' : '#/settings') }, icon('gear', 18)) : null, h('button', { type: 'button', class: route.name === 'help' ? 'icon on' : 'icon', 'aria-label': t(lang, 'helpTitle'), title: t(lang, 'helpTitle'), 'aria-pressed': String(route.name === 'help'), onClick: () => deps.setHash(route.name === 'help' ? '' : '#/help') }, icon('help', 18)), statusEl),
      h('main', { class: 'view' }, ...content),
      me ? h('nav', { class: 'tabbar' }, tab('following', '#/'), tab('mentions', '#/mentions'), tab('me', '#/me')) : null,
    ]
    // put the reader back where they were (unless this is a new view)
    root.replaceChildren(...page.filter((x): x is HTMLElement => x !== null))
    const main = root.querySelector('main.view')
    if (main) main.scrollTop = scrollToTop ? 0 : kept
    // coming from "Filter settings": land on the filter section, not at the top of Settings
    if (scrollToTop && route.name === 'settings' && route.focus === 'filter') root.querySelector('.settings')?.scrollIntoView({ block: 'start' })
    scrollToTop = false
  }

  deps.onHash(() => { void load() })
  // Coming back to the app after a while (an installed app stays alive in the background): show fresh notes, not what was there hours ago.
  deps.onVisible?.(() => { void checkUpdate(); if (me && !busy && (deps.nowMs?.() ?? Date.now()) - lastLoadAt > 120_000) refresh() })
  deps.onTick?.(() => { void checkUpdate() })
  deps.onPoll?.(() => { if (!busy) void poll() })
  void checkUpdate()
  draw()
  void load()
}
export type { Key }
