// The app: a login, two lists (following, mentions), a thread view, and — when a signer is configured — writing, replying and reacting through the
// user's remote signer. State lives here; everything else is a function of it.
import { nip19, verifyEvent, type Event as NostrEvent } from 'nostr-tools'
import { canRepost, repostTemplate } from '../core/repost.js'
import { hashtagTags, mentionTags, mergeTags, quoteContent, quoteTags, reactionTags, replyTags } from '../core/compose.js'
import { parseIdentity } from '../core/identity.js'
import { mentionedKeys, shortNpub } from '../core/refs.js'
import { isReply } from '../core/thread.js'
import { judgeAll, tally, type Context, type Judged, type Settings } from '../core/verdict.js'
import { loadNetwork } from '../data/network.js'
import { loadPopular } from '../data/popular.js'
import { deletionTemplate } from '../core/deletion.js'
import { aboutOf, aboutTemplate, MAX_ABOUT_CHARS, PROFILE_KIND } from '../core/profileedit.js'
import { loadTrust, type TrustScore } from '../data/trust.js'
import { matchNotes, matchPeople, MIN_QUERY, parseTarget, searchNetwork, searchTag, SEARCH_RELAYS, tagOf, type Found } from '../data/search.js'
import { loadProfile, type ProfileInfo } from '../data/profile.js'
import { followPubkeys, followTemplate, listKindOf, MUTE_LIST_KIND, type FollowAction } from '../core/follow.js'
import { addBackup, checkBase, loadFollowList, nextKnown, parseBackups } from '../data/followlist.js'
import { loadFollowing, loadMentions, loadMine, loadNames, loadNote, loadThread, type Thread, type ThreadNode } from '../data/feed.js'
import { Engagement, loadEngagement, normReaction } from '../data/engaged.js'
import { loadReach, type Reach } from '../data/reach.js'
import { countNew, groupReactions, groupReposts, loadActivity, mergeKnown, newFollowers, parseKnown, type Activity } from '../data/activity.js'
import { contextOf, loadGraphInfo, loadOwnLists, pendingGraph, type Session } from '../data/session.js'
import { DEFAULT_RELAYS, memo, type Fetcher } from '../net/fetcher.js'
import { failedRelays, type Publisher } from '../net/publisher.js'
import { PipelineError, signAndPublish, type Published, type SignerApi, type Step } from '../sign/pipeline.js'
import { checkTemplate, MAX_NOTE_CHARS, type Template } from '../sign/policy.js'
import { h } from './dom.js'
import { cobweb, icon, logo, pumpkin } from './icons.js'
import { detectLang, problemText, setSpooky, t, type Key, type Lang } from './i18n.js'
import { PAGE, renderContent, npubEl, renderTrust, renderPeople, renderProfileHead, renderProfileMode, renderRepostGroups, renderFollowers, renderFeedMode, renderHelp, renderPrefs, renderReactionGroups, avatarEl, nameOf, renderJudged, renderList, renderSettings, renderSummary, renderTree, type View } from './render.js'
import { reactionBar, renderSignArea, type Composer, type Flash, type FollowPanel, type Review } from './sign-ui.js'
import { installHint, type Env } from './install.js'
import { halloweenOn, parseScheme, parseTheme, type Scheme, type ThemeChoice, parseAvatars, parseFeedMode, parseFont, parseLang, parseReposts, parseSettings, parseWords, safeGet, safeSet, type AvatarStyle, type FeedMode, type FontSize, type KV } from './store.js'
import { addRelay, parseRelays, removeRelay } from '../net/relays.js'
import { listState, loadPublishedRelays, relayListTemplate } from '../data/relaylist.js'

export interface Deps {
  fetcher: Fetcher; /** Relays that can search text (NIP-50), asked only when the reader taps 'search the network too'. */ searchFetcher?: Fetcher; storage?: KV; languages?: readonly string[]; location: Pick<Location, 'hash'>; onHash: (cb: () => void) => void; setHash: (h: string) => void
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
  /** Is the screen wide enough for three columns? And a hook for "it just changed" (a window resized). */
  isWide?: () => boolean; onWide?: (cb: () => void) => void
  /** Is the system in light mode, and a hook for when it changes (for the Automatic theme). */
  prefersLight?: () => boolean; onSchemeChange?: (cb: () => void) => void
  /** Checks a signature (tests use events without real ones). */
  verify?: (e: NostrEvent) => boolean
}

type Route = { name: 'following' } | { name: 'search' } | { name: 'mentions' } | { name: 'me' } | { name: 'settings'; focus?: 'filter' } | { name: 'help' } | { name: 'user'; pubkey: string } | { name: 'people'; list: 'following' | 'followers' } | { name: 'note'; id: string; from?: string }
/** Someone with no account who opens a link to a note: they read that one public note and its replies, exactly as they are. No follows, no mutes, no rule that hides anything. */
const GUEST_CONTEXT: Context = { me: '', follows: new Set(), muted: new Set(), mutedWords: [], graph: { loaded: false, distance: () => null } }
const GUEST_SETTINGS: Settings = { rules: { repeatedText: false, burst: false, linkOnly: false, outsideNetwork: false }, maxDistance: 2, burstEvents: 5 }

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
  if (hash === '#/me/following' || hash === '#/me/followers') return { name: 'people', list: hash === '#/me/following' ? 'following' : 'followers' }
  const u = /^#\/user\/(.+)$/.exec(hash)
  if (u) { const r = parseIdentity(decodeURIComponent(u[1]!)); if (r.ok) return { name: 'user', pubkey: r.pubkey } } // an account: its key in hex, npub or nprofile
  return hash === '#/search' ? { name: 'search' } : hash === '#/mentions' ? { name: 'mentions' } : hash === '#/me' ? { name: 'me' } : hash === '#/help' ? { name: 'help' } : hash === '#/settings' ? { name: 'settings' } : hash === '#/settings/filter' ? { name: 'settings', focus: 'filter' } : { name: 'following' }
}

export function startApp(root: HTMLElement, deps: Deps): void {
  const fetcher = memo(deps.fetcher)
  const kv = deps.storage
  const { signer, publisher } = deps
  const defaultRelays = deps.relays ?? DEFAULT_RELAYS
  let relays = parseRelays(safeGet(kv, 'relays')) ?? defaultRelays
  let font: FontSize = parseFont(safeGet(kv, 'font'))
  let showReposts = parseReposts(safeGet(kv, 'reposts'))
  let autoImages = safeGet(kv, 'autoImages') === '1' // off unless chosen: a picture tells its site the reader's IP address
  let profileMode: 'notes' | 'replies' = 'notes' // what an account's page shows
  let avatarStyle: AvatarStyle = parseAvatars(safeGet(kv, 'avatars'))
  let feedMode: FeedMode = parseFeedMode(safeGet(kv, 'feed'))
  let scheme: Scheme = parseScheme(safeGet(kv, 'scheme'))
  let themeChoice: ThemeChoice = parseTheme(safeGet(kv, 'theme')) // null: never chosen, so the season decides
  const halloween = () => halloweenOn(themeChoice, new Date(deps.nowMs?.() ?? Date.now()))
  let relayError: string | null = null
  const probes = new Map<string, 'testing' | 'up' | 'down'>()
  let published: string[] | null | undefined // the relay list on Nostr: undefined = not read (yet), null = none
  let confirmingList = false
  let confirmingDisconnect = false
  let confirmingSignOut = false // Sign out also asks first: it forgets the account on this device
  // following: the list as the reader was seen to have it (a new list is refused if the one found lacks many of these), and the panel in progress
  const followingKey = () => `following:${me}`
  let knownFollowing: Set<string> | null = null
  const loadKnownFollowing = () => { knownFollowing ??= parseKnown(safeGet(kv, followingKey())); return knownFollowing }
  const saveKnownFollowing = (s: Set<string>) => { knownFollowing = s; safeSet(kv, followingKey(), JSON.stringify([...s])) }
  type FollowFlow = { stage: 'checking'; pubkey: string; action: FollowAction } | { stage: 'confirm'; pubkey: string; action: FollowAction; base: NostrEvent | null; changed: boolean } | { stage: 'refuse'; pubkey: string; action: FollowAction; why: 'none' | 'shrunk'; known: number; found: number; base: NostrEvent | null }
  let followFlow: FollowFlow | null = null
  // the reader's description (their profile's `about`) and its editor; declared up here because the first draw can come before the functions below run
  let myProfile: NostrEvent | null | undefined // undefined: not read yet; null: none found
  let aboutEdit: { text: string; busy: boolean; note: string | null } | null = null
  let aboutBox: HTMLTextAreaElement | null = null // kept across redraws while editing, so what is typed and the cursor stay
  let deletedCache: { who: string | null; ids: Set<string> } = { who: null, ids: new Set() } // the notes the reader deleted (see deletedIds); up here because the first draw already reads it
  let deleteConfirm: NostrEvent | null = null // one of the reader's notes about to be deleted (asks first: it cannot be undone)
  let shareConfirm: NostrEvent | null = null // the note about to be shared (sharing asks first: it is public)
  const shareable = new Set<string>() // ids of the notes whose bar offers Share (visible to the filter, shareable)
  const helpOpen = new Set<string>(['about']) // which Help sections are unfolded
  let adoptTried = false // the published list becomes this device's list at most once per page load, and only if the reader never chose one here
  deps.setRelays?.(relays)
  const applyTheme = () => {
    const on = halloween(), doc = root.ownerDocument
    if (on) doc.documentElement.setAttribute('data-theme', 'halloween'); else doc.documentElement.removeAttribute('data-theme')
    const light = !on && (scheme === 'light' || (scheme === 'auto' && !!deps.prefersLight?.())) // Halloween is dark, whatever the scheme
    if (light) doc.documentElement.setAttribute('data-scheme', 'light'); else doc.documentElement.removeAttribute('data-scheme')
    doc.querySelector('meta[name=theme-color]')?.setAttribute('content', on ? '#0f0a16' : light ? '#f5f7f9' : '#0b0f16')
    setSpooky(on)
  }
  const applyFont = () => root.ownerDocument.documentElement.setAttribute('data-font', font)
  applyFont(); applyTheme()
  let lang: Lang = parseLang(safeGet(kv, 'lang')) ?? detectLang(deps.languages)
  let settings: Settings = parseSettings(safeGet(kv, 'settings'))
  let words: string[] = parseWords(safeGet(kv, 'words'))
  let interests: string[] = parseWords(safeGet(kv, 'interests')) // topics the reader cares about: marked in the feeds, never moved or hidden (this device only)
  let me = ((): string | null => { const r = parseIdentity(safeGet(kv, 'me') ?? ''); return r.ok ? r.pubkey : null })()
  let session: Session | null = null
  let names = new Map<string, string>()
  let loginError: string | null = null
  let status: string | null = null
  let body: HTMLElement | null = null
  // the tab bar and the write button give their room back to the text while you read down, and come back when you scroll up (or are near the top, or something needs them)
  let barsHidden = false
  const HIDE_AFTER_PX = 120, SCROLL_STEP_PX = 10
  let guestBody: HTMLElement | null = null // the note a visitor without an account came to read
  // wide screens: three columns that are always there (each with its own content, load and scroll) and a panel on the right for a thread, an account or a list
  interface Pane { body: HTMLElement | null; run: number; resetScroll: boolean }
  const newPane = (): Pane => ({ body: null, run: 0, resetScroll: true })
  const panes = { following: newPane(), mentions: newPane(), me: newPane(), detail: newPane() }
  let detailKey = ''
  const wide = (): boolean => !!deps.isWide?.()
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
  const reachMap = new Map<string, Reach>() // what each of the reader's notes got from others (reactions, reposts, replies), filled in after the page is up
  const reachAsked = new Set<string>()
  // notes quoted inside other notes: asked for together once the page is up, then the view is built again with them inside
  const quotedMap = new Map<string, Judged | null>()
  const quoteWanted = new Set<string>(), quoteHints = new Map<string, string[]>() // where each quote says its note can be found
  let quoteTimer: ReturnType<typeof setTimeout> | undefined
  function wantQuote(id: string, relays?: string[]): void {
    if (relays?.length && !quoteHints.has(id)) quoteHints.set(id, relays)
    if (quotedMap.has(id) || quoteWanted.has(id)) return
    quoteWanted.add(id)
    clearTimeout(quoteTimer); quoteTimer = setTimeout(() => void fetchQuotes(), 150)
  }
  async function fetchQuotes(): Promise<void> {
    const ids = [...quoteWanted].filter((id) => !quotedMap.has(id)).slice(0, 100)
    quoteWanted.clear()
    if (!ids.length || !session || !me) return
    const who = me
    let found: NostrEvent[] = []
    try { found = await fetcher.query({ ids, kinds: [1], limit: ids.length }) } catch { /* not found: the button stays */ }
    // the quick question stops at a majority of the relays: a note held by only one of them (or by the relay its quote names) is asked for again,
    // this time waiting for every relay and asking those named relays too
    const missing = ids.filter((id) => !found.some((e) => e.id === id))
    if (missing.length && me === who) {
      const also = [...new Set(missing.flatMap((id) => quoteHints.get(id) ?? []))].slice(0, 4)
      try { found = [...found, ...await fetcher.query({ ids: missing, kinds: [1], limit: missing.length }, { quick: false, also })] } catch { /* still not found */ }
    }
    if (me !== who || !session) return
    const judged = judgeAll(found.filter((e) => ids.includes(e.id)), ctx(), settings)
    for (const id of ids) quotedMap.set(id, judged.find((j) => j.event.id === id) ?? null)
    if (!judged.length) return
    await nameKeys(judged.map((j) => j.event.pubkey)).catch(() => {})
    if (me === who) void load('all')
  }
  // The follow graph and the reader's own reactions come AFTER the first screen is on the page (checking hundreds of signatures keeps the browser too busy to answer the
  // feed's own queries: starting them together made the feed wait for them). `startBackground` is set when the account is loaded; `background()` runs it once.
  let startBackground: (() => Promise<void>) | null = null
  let backgroundRun: Promise<void> | null = null
  const background = (): Promise<void> => (backgroundRun ??= startBackground ? startBackground() : Promise.resolve())
  const afterFirstPaint = (): void => { if (backgroundRun === null && startBackground) setTimeout(() => { void background() }, 60) }
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
  const forgetAccount = () => { myProfile = undefined; aboutEdit = null; reachMap.clear(); reachAsked.clear(); quotedMap.clear(); trustMap.clear(); startBackground = null; backgroundRun = null; engagement = new Engagement(); for (const p of Object.values(panes)) { p.body = null; p.run++; p.resetScroll = true } detailKey = ''; followFlow = null; knownFollowing = null; shareConfirm = null; lastVerify = 0; seenAt = null; markFrom = null; badge = 0; knownFollowers = null; followersMark = null; followersSeen.clear() }
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
  const view = (): View => ({ lang, names, actions: signer ? actions : undefined, nowMs: deps.nowMs?.(), avatars: avatarStyle, halloween: halloween(), reach: (id: string) => reachMap.get(id), quoted: (id: string) => quotedMap.get(id), wantQuote, seen: rememberNotes, interests, deleted: deletedIds(), ...(me ? { self: me } : {}), ...(signer?.state === 'connected' && me ? { mute: (pk: string) => { if (pk !== me) void startFollow(pk, session?.muted.has(pk) ? 'unmute' : 'mute') }, isMuted: (pk: string) => !!session?.muted.has(pk), deleteNote: (e: NostrEvent) => { if (e.pubkey === me && e.kind === 1) { deleteConfirm = e; draw() } } } : {}), autoImages: (pk: string) => autoImages && !!session?.follows.has(pk), copy: (x) => deps.copy?.(x), hints: relays.slice(0, 2), ...(markFrom !== null ? { isNew: (e: NostrEvent) => e.created_at > markFrom! } : {}) })
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
    // Only what the first screen needs is waited for: your own lists (the Following feed is made of people you chose) and the relay list you published. The follow graph
    // (hundreds of lists, every signature checked) and what you already did to each note come after, in the background; when they are in, the page is built once more.
    const fetchAll = async () => {
      const [own, p] = await Promise.all([loadOwnLists(fetcher, who), loadPublishedRelays(fetcher, who).catch(() => undefined)]) // a failure only means "unknown"
      return { own, p }
    }
    let got: Awaited<ReturnType<typeof fetchAll>>
    try {
      got = await fetchAll()
      if (!adoptTried) {
        adoptTried = true
        if (got.p && safeGet(kv, 'relays') === null && !sameList(got.p, relays)) { // a new device: start from the list the reader published
          relays = got.p; safeSet(kv, 'relays', JSON.stringify(relays)); deps.setRelays?.(relays); fetcher.clear(); say('info', t(lang, 'listAdopted', { n: relays.length })) // from now on it is this device's own list: this happens once
          got = await fetchAll()
        }
      }
    } catch { status = null; return false }
    if (me !== who) return false // signed out or switched while loading
    const s: Session = { me: who, ...got.own, graphInfo: pendingGraph(who, got.own.follows) }
    session = s; published = got.p
    const mineEngagement = engagement = new Engagement()
    saveKnownFollowing(nextKnown(loadKnownFollowing(), s.follows)) // what the reader follows, as far as it is trusted
    backgroundRun = null
    startBackground = async () => {
      await Promise.allSettled([
        loadGraphInfo(fetcher, who, s.follows).then((g) => { if (session === s) s.graphInfo = g }),
        loadEngagement(fetcher, who).then((e) => mineEngagement.merge(e)), // what was done here in the meantime stays
      ])
      if (me === who && session === s) void load() // judge again with the graph and mark what you did
    }
    return true
  }

  async function nameThem(items: Judged[], extra: string[] = []): Promise<void> {
    const keys = [...extra, ...items.flatMap((j) => [j.event.pubkey, ...(j.repostedBy ?? []), ...(j.followedBy ?? []).slice(0, 1), ...(j.pickedBy ?? []).slice(0, 1), ...mentionedKeys(j.event.content)]), ...(signer?.pubkey ? [signer.pubkey] : [])].filter((k) => !names.has(k))
    if (!keys.length) return
    for (const [k, n] of await loadNames(fetcher, keys)) names.set(k, n)
  }

  /** Counts what the given notes got, a moment after the page is up, and builds the Me view once more with the numbers (the answers are remembered: no new questions). */
  function queueReach(ids: string[]): void {
    const todo = ids.filter((id) => !reachAsked.has(id))
    if (!todo.length) return
    for (const id of todo) reachAsked.add(id)
    const who = me, s = session
    setTimeout(() => {
      if (!who || me !== who || session !== s) return
      void loadReach(fetcher, todo, ctx()).then(async (found) => {
        if (me !== who || session !== s) return
        for (const [id, r] of found) reachMap.set(id, r)
        if (!found.size) return
        await nameKeys([...new Set([...found.values()].flatMap((r) => [...(r.who?.reactions.flatMap(([, k]) => k) ?? []), ...(r.who?.reposts ?? [])]))].slice(0, 300)).catch(() => {}) // the names the list of who reacted needs
        const route = parseRoute(deps.location.hash)
        if (wide()) void loadPane(panes.me, { name: 'me' }); else if (route.name === 'me') void load()
      }).catch(() => { /* a failed count only means no numbers */ })
    }, 150)
  }

  async function loadGuestNote(id: string, mine: number): Promise<void> {
    guestBody = h('p', { class: 'status loading', role: 'status' }, h('span', {}, t(lang, 'loadingFeed'))); draw()
    let out: HTMLElement
    try {
      const th = await loadThread(fetcher, id, GUEST_CONTEXT, GUEST_SETTINGS)
      if (mine !== run) return
      if (th) { await nameThem([...(th.root ? [th.root] : []), ...flat(th.replies)]); if (mine !== run) return }
      out = th ? threadView(th, null, true) : h('p', { class: 'empty' }, t(lang, 'noNote'))
    } catch { if (mine !== run) return; out = h('p', { class: 'empty' }, t(lang, 'noNote')) }
    guestBody = h('div', { class: 'stack guest' }, out, h('p', { class: 'meta guest-hint' }, t(lang, 'guestHint')))
    draw()
  }

  // Search. Every note Quill draws or lists is kept here (newest wins, up to a few thousand) so it can be found again without asking anyone.
  const knownNotes = new Map<string, Judged>()
  function rememberNotes(list: Judged[]): void {
    for (const j of list) { knownNotes.delete(j.event.id); knownNotes.set(j.event.id, j) }
    while (knownNotes.size > 5000) knownNotes.delete(knownNotes.keys().next().value!)
  }
  let searchQuery = ''
  let searchNet: { query: string; state: 'loading' } | { query: string; state: 'failed' } | { query: string; state: 'done'; notes: Judged[]; people: Found[] } | null = null
  let searchInput: HTMLInputElement | null = null
  // a single #tag is also asked of the reader's own relays (they all filter by tag), a moment after typing stops
  let tagSearch: { tag: string; state: 'loading' | 'failed' | 'done'; notes: Judged[] } | null = null
  let tagTimer: ReturnType<typeof setTimeout> | undefined
  function askTag(tag: string): void {
    if (tagSearch?.tag === tag) return
    tagSearch = { tag, state: 'loading', notes: [] }
    clearTimeout(tagTimer)
    tagTimer = setTimeout(() => void (async () => {
      const who = me
      try {
        const notes = await searchTag(fetcher, tag, ctx(), settings)
        if (me !== who || tagSearch?.tag !== tag) return
        await nameThem(notes.slice(0, PAGE)).catch(() => {})
        if (tagSearch?.tag === tag) tagSearch = { tag, state: 'done', notes }
      } catch { if (tagSearch?.tag === tag) tagSearch = { tag, state: 'failed', notes: [] } }
      drawSearch()
    })(), 400)
  }
  let searchResults: HTMLElement | null = null
  let searchTip: HTMLElement | null = null
  let searchPageEl: HTMLElement | null = null
  /** The search page is built once and kept: typing only redraws the results under the box, so the box keeps its focus and what was typed. */
  function searchPage(): HTMLElement {
    if (searchPageEl) { drawSearch(); return searchPageEl }
    searchInput = h('input', { type: 'search', class: 'search-box', placeholder: t(lang, 'searchPlaceholder'), 'aria-label': t(lang, 'search'), autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', enterkeyhint: 'search' }) as HTMLInputElement
    searchInput.value = searchQuery
    searchInput.addEventListener('input', () => { searchQuery = searchInput!.value; drawSearch() })
    searchResults = h('div', { class: 'stack search-results' })
    const form = h('form', { class: 'card search-form', role: 'search', onSubmit: (e: Event) => { e.preventDefault(); const target = parseTarget(searchQuery); if (target) deps.setHash(target.kind === 'user' ? `#/user/${target.pubkey}` : `#/note/${target.id}`); else searchInput?.blur() } },
      h('label', { class: 'search-row' }, icon('search', 20), searchInput), h('p', { class: 'meta search-note' }, t(lang, 'searchHint')), searchTip = h('p', { class: 'meta search-note', hidden: true }, t(lang, 'searchType')))
    searchPageEl = h('div', { class: 'stack search' }, form, searchResults)
    drawSearch()
    setTimeout(() => { if (searchInput?.isConnected && !searchQuery) searchInput.focus() }, 0) // opened to type: the box is ready
    return searchPageEl
  }
  function drawSearch(): void {
    if (!searchResults || !session) return
    const q = searchQuery.trim(), v = view(), parts: (HTMLElement | null)[] = []
    const target = parseTarget(q)
    if (target) parts.push(h('p', {}, h('a', { class: 'button primary', href: target.kind === 'user' ? `#/user/${target.pubkey}` : `#/note/${target.id}` }, t(lang, target.kind === 'user' ? 'searchOpenAccount' : 'searchOpenNote'))))
    else if (q.length < MIN_QUERY) { /* the tip under the box says what to type */ }
    else {
      const tag = tagOf(q)
      if (tag) askTag(tag); else { clearTimeout(tagTimer); tagSearch = null }
      const people = matchPeople(names, q, ctx()), local = matchNotes(knownNotes.values(), q)
      const fromTag = tagSearch?.tag === tag && tagSearch.state === 'done' ? tagSearch.notes.filter((j) => !local.some((l) => l.event.id === j.event.id)) : []
      const notes = [...local, ...fromTag].sort((a, b) => b.event.created_at - a.event.created_at)
      if (tag && tagSearch?.tag === tag && tagSearch.state !== 'done') parts.push(h('p', { class: tagSearch.state === 'loading' ? 'status loading' : 'meta', role: 'status' }, h('span', {}, t(lang, tagSearch.state === 'loading' ? 'searchTagLoading' : 'searchTagFailed', { tag: '#' + tag }))))
      if (people.length) parts.push(peopleCard(t(lang, 'searchPeople'), people, v))
      if (notes.length) parts.push(h('h2', { class: 'section' }, `${t(lang, 'searchNotes')} · ${notes.length}`), renderList(notes, { ...v, seen: undefined }))
      if (!people.length && !notes.length) parts.push(h('p', { class: 'empty' }, t(lang, 'searchNone')))
      parts.push(netSection(q, v, new Set(people.map((p) => p.pubkey)), new Set(notes.map((n) => n.event.id))))
    }
    if (searchTip) searchTip.hidden = !!target || q.length >= MIN_QUERY
    searchResults.replaceChildren(...parts.filter((x): x is HTMLElement => x !== null))
  }
  function peopleCard(title: string, people: Found[], v: View): HTMLElement {
    return h('section', { class: 'card search-people' }, h('h2', {}, `${title} · ${people.length}`),
      h('ul', {}, ...people.map((p) => h('li', {}, h('a', { href: `#/user/${p.pubkey}` }, avatarEl(p.pubkey, v), h('strong', {}, p.name)), p.relation === 'none' ? null : h('span', { class: 'meta' }, t(lang, p.relation === 'follow' ? 'relFollow' : 'relNetwork'))))))
  }
  function netSection(q: string, v: View, havePeople: Set<string>, haveNotes: Set<string>): HTMLElement | null {
    if (!deps.searchFetcher) return null
    const net = searchNet?.query === q ? searchNet : null
    if (!net) return h('div', { class: 'search-net' }, h('button', { type: 'button', onClick: () => void runNetSearch(q) }, icon('search', 16), t(lang, 'searchNet')), h('p', { class: 'meta' }, t(lang, 'searchNetHint', { relays: SEARCH_RELAYS.map((r) => r.replace(/^wss:\/\//, '')).join(' · ') })))
    if (net.state === 'loading') return h('p', { class: 'status loading', role: 'status' }, h('span', {}, t(lang, 'searchNetLoading')))
    if (net.state === 'failed') return h('div', { class: 'search-net' }, h('p', { class: 'error' }, t(lang, 'searchNetFailed')), h('button', { type: 'button', onClick: () => void runNetSearch(q) }, t(lang, 'searchRetry')))
    const people = net.people.filter((p) => !havePeople.has(p.pubkey)), notes = net.notes.filter((n) => !haveNotes.has(n.event.id))
    return h('div', { class: 'stack search-net' }, h('h2', { class: 'section' }, t(lang, 'searchNetFrom')),
      people.length ? peopleCard(t(lang, 'searchPeople'), people, v) : null,
      notes.length ? h('h2', { class: 'section' }, `${t(lang, 'searchNotes')} · ${notes.length}`) : null, notes.length ? renderList(notes, v) : null,
      !people.length && !notes.length ? h('p', { class: 'empty' }, t(lang, 'searchNetNone')) : null)
  }
  async function runNetSearch(q: string): Promise<void> {
    if (!deps.searchFetcher || !session) return
    const who = me
    searchNet = { query: q, state: 'loading' }; drawSearch()
    try {
      const found = await searchNetwork(deps.searchFetcher, q, ctx(), settings)
      if (me !== who) return
      for (const p of found.people) if (!names.has(p.pubkey)) names.set(p.pubkey, p.name)
      await nameThem(found.notes.slice(0, PAGE)).catch(() => {})
      if (me !== who || searchNet?.query !== q) return
      searchNet = { query: q, state: 'done', notes: found.notes, people: found.people }
    } catch { if (searchNet?.query === q) searchNet = { query: q, state: 'failed' } }
    drawSearch()
  }

  /** The content of one view (a feed, a thread, an account, a list…). `alive` says whether the answer is still wanted: when it is not, null comes back. */
  async function buildContent(route: Route, alive: () => boolean): Promise<HTMLElement | null> {
    if (route.name === 'search') return searchPage()
    if (route.name === 'mentions' || route.name === 'note' || (route.name === 'following' && feedMode === 'network')) await background() // they judge by the graph; the Following feed and Me do not
    let content: HTMLElement
    try {
      if (route.name === 'note') {
        const [th, source] = await Promise.all([loadThread(fetcher, route.id, ctx(), settings), route.from ? loadNote(fetcher, route.from, ctx(), settings).catch(() => null) : Promise.resolve(null)])
        if (!alive()) return null
        if (!th) content = h('div', { class: 'stack' }, sourceCard(source), h('p', { class: 'empty' }, t(lang, 'noNote')))
        else { await nameThem([...(th.root ? [th.root] : []), ...flat(th.replies), ...(source ? [source] : [])]); content = threadView(th, source) }
      } else if (route.name === 'people') {
        if (route.list === 'followers' && loadKnown() === null && followersSeen.size === 0) await poll() // never looked yet: learn who follows you first
        if (!alive()) return null
        content = await peopleView(route.list, alive)
        if (!alive()) return null
      } else if (route.name === 'user') {
        const { info, notes, own } = await loadProfile(fetcher, route.pubkey, session!, ctx(), settings)
        if (!alive()) return null
        askTrust(route.pubkey, own)
        await nameThem(notes, [info.pubkey, ...info.via.slice(0, 3)]); content = profileView(info, notes)
      } else {
        let act: Activity | null = null
        if (route.name === 'mentions') {
          if (seenAt === null) loadSeen()
          const opts = activityOptions(); act = await loadActivity(fetcher, ctx(), settings, opts); afterActivity(act, !!opts.verifyKnown)
        }
        const items = act ? act.notes : route.name === 'me' ? (await Promise.all([loadMine(fetcher, ctx(), settings), loadMyProfile()]))[0] : (feedMode === 'network' ? await loadNetwork(fetcher, session!, ctx(), settings) : feedMode === 'popular' ? await loadPopular(fetcher, ctx(), nowSec(), settings) : await loadFollowing(fetcher, ctx(), settings, { reposts: showReposts }))
        if (!alive()) return null
        // the first visit to Mentions ever takes the followers of today as its starting point (nothing is "new" yet); later, the ones not seen before are
        const baseline = act ? (loadKnown() ?? new Set(act.followers)) : null
        if (act) for (const k of act.followers) followersSeen.add(k)
        if (act && followersMark === null) followersMark = baseline
        const fresher = act ? newFollowers(act, followersMark!) : []
        // the names of what is on the first page come first; the rest are asked for once it is on screen (a card of a later page is built when "Show more" is tapped, by then they are in)
        await nameThem(act ? [...items.slice(0, PAGE), ...act.reactions, ...act.reposts] : items.slice(0, PAGE), fresher.slice(0, 8))
        if (items.length > PAGE) setTimeout(() => { void nameThem(items.slice(PAGE)) }, 300)
        if (route.name === 'me' && !names.has(me!)) for (const [k, n] of await loadNames(fetcher, [me!])) names.set(k, n)
        if (act) {
          if (markFrom === null) markFrom = seenAt ?? nowSec() // first ever visit: nothing is "new"
          const fresh = countNew(act, markFrom, followersMark!)
          markSeen(); saveKnown(mergeKnown(baseline!, act))
          const block = renderReactionGroups(groupReactions(act, markFrom), view())
          const line = fresh.shown || fresh.hidden ? h('p', { class: 'meta new-line', role: 'status' }, [fresh.shown ? t(lang, 'newItems', { n: fresh.shown }) : '', fresh.hidden ? t(lang, 'newHidden', { n: fresh.hidden }) : ''].filter(Boolean).join(' · ')) : null
          content = h('div', { class: 'stack' }, renderSummary(tally(items), view(), toggleSettings), line, renderFollowers(fresher, view()), block, renderRepostGroups(groupReposts(act, markFrom), view()), renderList(items, view()))
        } else if (route.name === 'me') { content = renderList(items, view()); queueReach(items.map((j) => j.event.id)) }
        else {
          // Following: the people you follow, or the network; in the network an empty list says why (no follow lists arrived, or just nothing new)
          const network = route.name === 'following' && feedMode === 'network'
          const empty = network && !items.length ? h('p', { class: 'empty' }, t(lang, session!.graphInfo.answered === 0 ? 'networkNotLoaded' : 'networkEmpty')) : route.name === 'following' && feedMode === 'popular' && !items.length ? h('p', { class: 'empty' }, t(lang, 'popularEmpty')) : null
          if (route.name === 'following' && feedMode === 'follows' && items.length) saveFeedCache(items)
          content = h('div', { class: 'stack' }, route.name === 'following' ? renderFeedMode(feedMode, changeFeedMode, view()) : null, renderSummary(tally(items), view(), toggleSettings), empty ?? renderList(items, view()))
        }
      }
    } catch { content = h('p', { class: 'empty' }, t(lang, 'noNote')) }
    return alive() ? content : null
  }

  /** Loads one column (or the panel). The old content stays until the new one is ready, as in a refresh of the single column. */
  let paneJobs = 0 // loads in flight: the refresh button turns (the `status`) while there is any, and only then
  async function loadPane(p: Pane, route: Route): Promise<void> {
    const my = ++p.run
    paneJobs++; status = t(lang, 'loadingFeed')
    let content: HTMLElement | null = null
    try { content = await buildContent(route, () => my === p.run && !!me) } finally { if (--paneJobs === 0) status = null }
    if (content === null) { if (paneJobs === 0) draw(); return }
    p.body = content; lastLoadAt = deps.nowMs?.() ?? Date.now(); draw(); afterFirstPaint()
  }

  /** Wide screens. 'all': every column and the panel; 'route': only the panel (the address changed, the columns are what they were). */
  async function loadWide(scope: 'all' | 'route'): Promise<void> {
    const mine = ++run
    if (!me) {
      const r = parseRoute(deps.location.hash)
      if (r.name === 'note') return void loadGuestNote(r.id, mine)
      guestBody = null; return draw()
    }
    if (!panes.following.body && feedMode === 'follows') { const cached = cachedFeed(); if (cached) { panes.following.body = cached; draw() } }
    if (!(await ensureSession()) || !session) return
    if (paneJobs === 0) status = null // reading the account is done; what turns the button now is the columns loading
    const route = parseRoute(deps.location.hash)
    const jobs: Promise<void>[] = [] // Settings and Help too: a change made there (avatars, filter, relays) must already be in the columns when you go back
    if (scope === 'all') for (const id of ['following', 'mentions', 'me'] as const) jobs.push(loadPane(panes[id], { name: id }))
    if (route.name === 'note' || route.name === 'user' || route.name === 'people') {
      const key = JSON.stringify(route)
      if (scope === 'all' || key !== detailKey) {
        if (key !== detailKey) { panes.detail.body = null; panes.detail.resetScroll = true; profileMode = 'notes' }
        detailKey = key; jobs.push(loadPane(panes.detail, route))
      }
    } else { detailKey = ''; panes.detail.body = null; panes.detail.run++ }
    draw()
    await Promise.all(jobs)
  }

  // The Following feed as it was last time, kept on this device: shown at once when the app opens, replaced by the fresh one when it arrives.
  // Only the first notes and the names they need; every signature is checked again when it is read back.
  const FEED_CACHE_ITEMS = 40
  const feedCacheKey = () => `feedcache:${me}`
  function saveFeedCache(items: Judged[]): void {
    const kept = items.slice(0, FEED_CACHE_ITEMS)
    const keys = new Set(kept.flatMap((j) => [j.event.pubkey, ...(j.repostedBy ?? [])]))
    safeSet(kv, feedCacheKey(), JSON.stringify({ items: kept, names: [...keys].filter((k) => names.has(k)).map((k) => [k, names.get(k)]) }))
  }
  function cachedFeed(): HTMLElement | null {
    try {
      const raw = JSON.parse(safeGet(kv, feedCacheKey()) ?? 'null') as { items?: Judged[]; names?: [string, string][] } | null
      if (!raw || !Array.isArray(raw.items) || !raw.items.length) return null
      const items = raw.items.filter((j) => j && j.event && j.verdict && typeof j.verdict.hidden === 'boolean' && (deps.verify ?? verifyEvent)({ ...j.event }))
      if (!items.length) return null
      for (const [k, n] of raw.names ?? []) if (typeof k === 'string' && typeof n === 'string' && !names.has(k)) names.set(k, n)
      return h('div', { class: 'stack' }, renderFeedMode(feedMode, changeFeedMode, view()), renderSummary(tally(items), view(), toggleSettings), renderList(items, view()))
    } catch { return null }
  }

  async function load(scope: 'all' | 'route' = 'all'): Promise<void> {
    if (wide()) return loadWide(scope)
    const mine = ++run
    if (!me) {
      const r = parseRoute(deps.location.hash)
      if (r.name === 'note') return void loadGuestNote(r.id, mine)
      guestBody = null; return draw()
    }
    const first = parseRoute(deps.location.hash)
    if (!body && first.name === 'following' && feedMode === 'follows') { const cached = cachedFeed(); if (cached) { body = cached; shownRoute = JSON.stringify(first); draw() } }
    if (!(await ensureSession()) || mine !== run || !session) return
    const route = parseRoute(deps.location.hash)
    const key = JSON.stringify(route)
    if (key !== shownRoute) { body = null; shownRoute = key; scrollToTop = true; profileMode = 'notes'; if (route.name !== 'mentions') { markFrom = null; followersMark = null } }
    if (route.name === 'settings' || route.name === 'help') { status = null; body = null; draw(); return }
    status = t(lang, 'loadingFeed'); draw()
    const content = await buildContent(route, () => mine === run)
    if (content === null) return
    status = null; body = content; lastLoadAt = deps.nowMs?.() ?? Date.now(); draw(); afterFirstPaint()
    if (route.name !== 'mentions') void poll()
  }

  /** Looks for what is new around my notes since the last visit to Mentions and shows how many things the filter lets through as a number on the tab. */
  async function poll(): Promise<void> {
    if (!me || !session || parseRoute(deps.location.hash).name === 'mentions') return
    if (seenAt === null) loadSeen()
    try {
      fetcher.clear()
      // only what is new since the last visit to Mentions (with two minutes of margin), unless it is time to check every follower again (then everything)
      const base = activityOptions(), incremental = seenAt !== null && loadKnown() !== null && !base.verifyKnown
      const opts = incremental ? { ...base, since: seenAt! - 120 } : base, a = await loadActivity(fetcher, ctx(), settings, opts)
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
  function refresh(): void { fetcher.clear(); reachMap.clear(); reachAsked.clear(); quotedMap.clear(); trustMap.clear(); session = null; void load() }

  const flat = (nodes: ThreadNode[]): Judged[] => nodes.flatMap((n) => [n.item, ...flat(n.children)])

  /** Where you came from: the note whose "Quoted note" button was tapped. */
  function sourceCard(source: Judged | null): HTMLElement | null {
    return source ? h('section', { class: 'quoted-from' }, h('p', { class: 'meta' }, t(lang, 'quotedFrom')), renderJudged(source, view())) : null
  }
  /** What the sign area shows of a follow / unfollow in progress. */
  function followPanel(): FollowPanel | null {
    const f = followFlow
    if (!f) return null
    if (f.stage === 'checking') return { stage: 'checking', action: f.action }
    if (f.stage === 'refuse') return { stage: 'refuse', action: f.action, why: f.why, known: f.known, found: f.found }
    const before = f.base ? followPubkeys(f.base).length : 0
    return { stage: 'confirm', who: nameOf(view(), f.pubkey), action: f.action, before, after: before + (f.action === 'follow' || f.action === 'mute' ? 1 : -1), changed: f.changed }
  }

  /** "Back": to where you came from (the browser's history), or to the start when there is none. */
  const backLink = () => h('a', { class: 'back', href: '#/', onClick: (e: Event) => { e.preventDefault(); if (deps.goBack) deps.goBack(); else deps.setHash('') } }, icon('back', 16), t(lang, 'back'))

  // How much the network vouches for an account (nostrclaw's score): asked once per account and visit, after the page is up; the page is drawn again when it arrives.
  const trustMap = new Map<string, TrustScore | 'loading' | 'failed'>()
  function askTrust(pubkey: string, own: NostrEvent[]): void {
    if (trustMap.has(pubkey) || !session) return
    trustMap.set(pubkey, 'loading')
    const who = me
    void loadTrust(fetcher, pubkey, ctx(), own, nowSec()).then((t) => { trustMap.set(pubkey, t) }, () => { trustMap.set(pubkey, 'failed') }).then(() => {
      if (me !== who) return
      const r = parseRoute(deps.location.hash)
      if (r.name === 'user' && r.pubkey === pubkey) { if (wide()) void loadPane(panes.detail, r); else void load('route') }
    })
  }
  /** The page of an account: its profile as text, how it relates to you, and its notes (or replies). */
  function profileView(info: ProfileInfo, notes: Judged[]): HTMLElement {
    const relation = info.pubkey === me ? 'you' : session!.muted.has(info.pubkey) ? 'muted' : session!.follows.has(info.pubkey) ? 'follow' : 'none'
    const shown = notes.filter((n) => isReply(n.event) === (profileMode === 'replies'))
    const canFollow = signer?.state === 'connected' && info.pubkey !== me
    return h('div', { class: 'stack' }, backLink(), renderProfileHead(info, relation, view(), canFollow ? { following: session!.follows.has(info.pubkey), muted: session!.muted.has(info.pubkey), busy: !!followFlow || busy, onToggle: () => void startFollow(info.pubkey, session!.follows.has(info.pubkey) ? 'unfollow' : 'follow'), onMute: () => void startFollow(info.pubkey, session!.muted.has(info.pubkey) ? 'unmute' : 'mute') } : undefined), info.pubkey === me ? null : renderTrust(trustMap.get(info.pubkey), view()), renderProfileMode(profileMode, (m) => { profileMode = m; void load() }, view()),
      shown.length ? renderSummary(tally(shown), view(), toggleSettings) : null, shown.length ? renderList(shown, view()) : h('p', { class: 'empty' }, t(lang, 'profileEmpty')))
  }

  function threadView(th: Thread, source: Judged | null = null, guest = false): HTMLElement {
    const all = [...(th.root ? [th.root] : []), ...flat(th.replies)]
    return h('div', { class: 'stack' },
      guest ? null : backLink(),
      sourceCard(source),
      guest ? null : renderSummary(tally(all), view(), toggleSettings),
      th.root ? renderJudged(th.root, view()) : null,
      h('h3', {}, th.total === 1 ? t(lang, 'reachRepliesOne') : t(lang, 'reachReplies', { n: th.total })),
      ...renderTree(th.replies, view()),
    )
  }

  function toggleSettings(): void { deps.setHash('#/settings/filter') } // the filter settings live in Settings
  function changeSettings(s: Settings): void { settings = s; safeSet(kv, 'settings', JSON.stringify(s)); void load() }
  function changeFeedMode(m: FeedMode): void { feedMode = m; safeSet(kv, 'feed', m === 'follows' ? null : m); void load() }
  function changeAvatars(a: AvatarStyle): void { avatarStyle = a; safeSet(kv, 'avatars', a === 'initials' ? null : a); void load() } // the cards are built once and kept: they are rebuilt with the new pictures
  function changeAutoImages(on: boolean): void { autoImages = on; safeSet(kv, 'autoImages', on ? '1' : null); draw() }
  function changeReposts(on: boolean): void { showReposts = on; safeSet(kv, 'reposts', on ? null : '0'); void load() }
  function changeScheme(x: Scheme): void { scheme = x; safeSet(kv, 'scheme', x === 'dark' ? null : x); applyTheme(); draw() }
  function changeTheme(on: boolean): void { themeChoice = on ? 'halloween' : 'default'; safeSet(kv, 'theme', themeChoice); applyTheme(); draw() } // an explicit choice, kept, wins over the season
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
  function changeInterests(text: string): void { interests = parseWords(text); safeSet(kv, 'interests', interests.length ? interests.join('\n') : null); draw(); if (wide()) void load('all') }
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
    else if (e instanceof PipelineError) say('error', t(lang, e.code === 'rate' ? 'e_rate' : e.code === 'no-signer' ? 'e_no_signer' : /did not answer within/.test(e.message) ? 'e_asleep' : 'e_not_signed', { why: e.message.trim() || t(lang, 'noReason') }))
    else say('error', t(lang, 'e_not_signed', { why: (e instanceof Error ? e.message : String(e)).trim() || t(lang, 'noReason') }))
  }

  async function send(template: Template, opts: { followBase?: NostrEvent | null; me?: string; profileBase?: NostrEvent; deleteTarget?: NostrEvent } = {}): Promise<boolean> {
    if (!signer || !publisher) return false
    // Still waiting for the signer to answer an earlier tap (e.g. Clave was closed): a new tap replaces it, so opening Clave and tapping again works.
    // Once the signature is made and the event is being sent, a second tap is ignored (no double posts).
    if (busy && step === 'waiting') { signing?.abort(); await current?.catch(() => {}) } else if (busy) return false
    busy = true; flash = null; result = null; const mine = signing = new AbortController(); draw()
    current = (async () => {
      try {
        result = await signAndPublish({ signer, publisher, kv, now: deps.nowMs, signal: mine.signal, followBase: opts.followBase, ...(opts.profileBase ? { profileBase: opts.profileBase } : {}), ...(opts.deleteTarget ? { deleteTarget: opts.deleteTarget } : {}) }, template, (s) => { step = s; draw() })
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
  /** What the reader was seen to have in a list: their follows (kept on the device), or their mutes (as read when the account was loaded). */
  const knownOf = (kind: number): ReadonlySet<string> | null => (kind === MUTE_LIST_KIND ? session?.muted ?? null : loadKnownFollowing())
  /** Following or unfollowing (and muting or unmuting: the same care, another list): read the newest list NOW, check it looks like the list the reader has been seen to have, and show exactly what will change. */
  async function startFollow(pubkey: string, action: FollowAction): Promise<void> {
    if (!signer || signer.state !== 'connected' || busy || !me || pubkey === me) return
    followFlow = { stage: 'checking', pubkey, action }; draw()
    fetcher.clear()
    const kind = listKindOf(action), muting = kind === MUTE_LIST_KIND
    let base: NostrEvent | null = null
    try { base = await loadFollowList(fetcher, me, kind) } catch { base = null }
    if (!followFlow || followFlow.stage !== 'checking') return // cancelled meanwhile
    const verdict = checkBase(base, knownOf(kind), muting)
    if (!verdict.ok) { followFlow = { stage: 'refuse', pubkey, action, why: verdict.why, known: verdict.known, found: verdict.found, base }; return draw() }
    if (!followTemplate(base, pubkey, action, nowSec(), me)) { followFlow = null; say('info', t(lang, muting ? (action === 'mute' ? 'profileMuted' : 'profileNotMuted') : action === 'follow' ? 'profileFollowed' : 'profileNotFollowed')); return draw() } // already so
    followFlow = { stage: 'confirm', pubkey, action, base, changed: false }; draw()
  }
  /** The reader says the list they have now is the right one (they removed many accounts on purpose): it becomes the reference, and the change goes on. */
  function acceptList(): void {
    const f = followFlow
    if (!f || f.stage !== 'refuse' || !f.base) return
    if (listKindOf(f.action) === MUTE_LIST_KIND) { if (session) session.muted = new Set(followPubkeys(f.base)) } else saveKnownFollowing(new Set(followPubkeys(f.base)))
    void startFollow(f.pubkey, f.action)
  }
  async function confirmFollow(): Promise<void> {
    const f = followFlow
    if (!f || f.stage !== 'confirm' || !me || !signer || signer.state !== 'connected') return
    // the list is read AGAIN right before signing: if it changed meanwhile (another app), the reader sees the new numbers and confirms again
    fetcher.clear()
    const kind = listKindOf(f.action), muting = kind === MUTE_LIST_KIND
    let fresh: NostrEvent | null = null
    try { fresh = await loadFollowList(fetcher, me, kind) } catch { fresh = null }
    if (!followFlow || followFlow.stage !== 'confirm') return
    const verdict = checkBase(fresh, knownOf(kind), muting)
    if (!verdict.ok) { followFlow = { stage: 'refuse', pubkey: f.pubkey, action: f.action, why: verdict.why, known: verdict.known, found: verdict.found, base: fresh }; return draw() }
    if ((fresh?.id ?? null) !== (f.base?.id ?? null)) { followFlow = { ...f, base: fresh, changed: true }; return draw() }
    const template = followTemplate(fresh, f.pubkey, f.action, nowSec(), me)
    const problem = template ? checkTemplate(template, { followBase: fresh, me }) : 'follow'
    if (!template || problem) { followFlow = null; say('error', problemText(lang, problem ?? 'follow')); return draw() }
    followFlow = null
    if (!muting) safeSet(kv, `followbackup:${me}`, JSON.stringify(addBackup(parseBackups(safeGet(kv, `followbackup:${me}`)), fresh!))) // a copy of the list as it was, kept on this device
    if (await send(template, { followBase: fresh, me })) {
      const next = new Set(followPubkeys({ tags: template.tags }))
      if (muting) session!.muted = next; else { session!.follows = next; saveKnownFollowing(next) }
      const name = nameOf(view(), f.pubkey)
      // the relays take a moment to show a new list: look again a couple of times before saying they do not
      let confirmed = false
      for (const wait of deps.verifyWaitsMs ?? [1500, 3000]) {
        await new Promise((r) => setTimeout(r, wait))
        try { fetcher.clear(); const after = await loadFollowList(fetcher, me, kind); confirmed = !!after && sameFollows(new Set(followPubkeys(after)), next) } catch { confirmed = false }
        if (confirmed) break
      }
      if (result && !failedRelays(result.outcomes).length) result = null
      say('info', confirmed ? t(lang, `${f.action}Done` as 'followDone', { who: name }) : t(lang, 'followUnconfirmed'), confirmed ? undefined : 7000)
      draw(); void load() // the feed and the counts follow the new list
      return
    }
    draw()
  }

  // Notes the reader deleted from here, remembered on the device: a relay that ignores the request (some do) must not bring them back into view.
  const deletedKey = () => `deleted:${me}`
  function deletedIds(): Set<string> {
    if (deletedCache.who !== me) { let ids: string[] = []; try { const v = JSON.parse(safeGet(kv, deletedKey()) ?? '[]') as unknown; if (Array.isArray(v)) ids = v.filter((x): x is string => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x)) } catch { /* none */ } deletedCache = { who: me, ids: new Set(ids) } }
    return deletedCache.ids
  }
  async function deleteNote(): Promise<void> {
    const target = deleteConfirm; deleteConfirm = null
    if (!target || !me || target.pubkey !== me || !signer || signer.state !== 'connected') return draw()
    const template = deletionTemplate(target, nowSec())
    const problem = checkTemplate(template, { deleteTarget: target })
    if (problem) { say('error', problemText(lang, problem)); return draw() }
    if (await send(template, { deleteTarget: target })) {
      const ids = deletedIds(); ids.add(target.id); safeSet(kv, deletedKey(), JSON.stringify([...ids].slice(-500)))
      if (result && !failedRelays(result.outcomes).length) { result = null; say('info', t(lang, 'deleteDone')) }
      void load()
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

  /** Display names for some keys, asked of the relays only for the ones not known yet. */
  async function nameKeys(keys: string[]): Promise<void> {
    const missing = keys.filter((k) => !names.has(k))
    if (!missing.length) return
    for (const [k, n] of await loadNames(fetcher, missing)) names.set(k, n)
  }

  /** The two lists behind the counts in Me. Following is your own list, exact; followers is what this app has seen (the same ~N as the count), so it says so. */
  async function peopleView(list: 'following' | 'followers', alive: () => boolean): Promise<HTMLElement> {
    const followers = [...new Set([...(loadKnown() ?? []), ...followersSeen])] // oldest seen first
    const followerSet = new Set(followers)
    const keys = (list === 'following' ? [...session!.follows] : followers).reverse() // newest first
    const rows = keys.map((k) => ({ pubkey: k, tag: list === 'following' ? (followerSet.has(k) ? t(lang, 'followsYou') : null) : (session!.follows.has(k) ? t(lang, 'youFollow') : null) }))
    await nameKeys(rows.slice(0, PAGE).map((r) => r.pubkey))
    return h('div', { class: 'stack' }, backLink(), renderPeople(rows, view(), {
      title: t(lang, list === 'following' ? 'peopleFollowing' : 'peopleFollowers'), count: rows.length,
      note: t(lang, list === 'following' ? 'followingNote' : 'followersNote'), approximate: list === 'followers',
      nameThem: (ks) => (alive() ? nameKeys(ks) : Promise.resolve()),
    }))
  }

  /** "128 following · ~37 followers": the first is exact (it is your own list), the second is approximate (what the relays showed; there is no official count and every app counts its own way). */
  function countsLine(): HTMLElement | null {
    if (!session) return null
    const n = followerCount()
    const followers = n === null ? null : n === 0 ? t(lang, 'followersNone') : t(lang, n === 1 ? 'followersAtLeastOne' : 'followersAtLeast', { n })
    return h('div', { class: 'meta counts' }, h('a', { href: '#/me/following' }, t(lang, 'followingN', { n: session.follows.size })), followers ? ' · ' : null, followers ? h('a', { href: '#/me/followers' }, followers) : null)
  }

  function accountCard(): HTMLElement {
    const head = h('div', { class: 'account-top' }, avatarEl(me!, view(), 'lg'), h('div', {}, h('strong', {}, nameOf(view(), me!)), npubEl(me!, view()), countsLine()))
    return h('section', { class: 'account card' }, head, aboutArea())
  }
  // The reader's description (the `about` of their profile): shown under their name, and editable with a signer. A profile is one event that a new one
  // replaces whole, so the newest one is read right before signing and only `about` changes (see core/profileedit.ts).
  async function loadMyProfile(): Promise<void> {
    if (!me) return
    const who = me
    try { const p = await loadFollowList(fetcher, who, PROFILE_KIND); if (me === who) myProfile = p } catch { /* keeps what it had */ }
  }
  function aboutArea(): HTMLElement | null {
    const canEdit = signer?.state === 'connected'
    if (aboutEdit) {
      if (!aboutBox) {
        const box = aboutBox = h('textarea', { class: 'about-edit', rows: '5', maxlength: String(MAX_ABOUT_CHARS), 'aria-label': t(lang, 'aboutLabel') }) as HTMLTextAreaElement
        box.value = aboutEdit.text
        box.addEventListener('input', () => { if (aboutEdit) aboutEdit.text = box.value })
        setTimeout(() => { if (box.isConnected) box.focus() }, 0)
      } else if (aboutBox.value !== aboutEdit.text) aboutBox.value = aboutEdit.text
      const box = aboutBox
      box.disabled = aboutEdit.busy
      return h('div', { class: 'about-area' },
        box, aboutEdit.note ? h('p', { class: 'error', role: 'alert' }, aboutEdit.note) : null, h('p', { class: 'meta' }, t(lang, 'aboutPublic')),
        h('p', { class: 'buttons' }, h('button', { type: 'button', class: 'primary', ...(aboutEdit.busy || busy ? { disabled: true } : {}), onClick: () => void saveAbout() }, t(lang, aboutEdit.busy ? 'aboutSaving' : 'aboutSave')), ' ', h('button', { type: 'button', class: 'link', ...(aboutEdit.busy ? { disabled: true } : {}), onClick: () => { aboutEdit = null; draw() } }, t(lang, 'cancel'))))
    }
    aboutBox = null
    const about = aboutOf(myProfile)
    if (!about && !canEdit) return null
    return h('div', { class: 'about-area' },
      about ? h('div', { class: 'about' }, renderContent(about, view())) : h('p', { class: 'meta' }, t(lang, myProfile === undefined ? 'aboutLoading' : 'aboutNone')),
      canEdit && myProfile ? h('p', { class: 'buttons' }, h('button', { type: 'button', onClick: () => { aboutEdit = { text: about, busy: false, note: null }; draw() } }, t(lang, 'aboutEditButton'))) : null)
  }
  async function saveAbout(): Promise<void> {
    const e = aboutEdit
    if (!e || e.busy || !me || !signer || signer.state !== 'connected') return
    const who = me, text = e.text.replace(/\r\n/g, '\n').trim()
    e.busy = true; e.note = null; draw()
    fetcher.clear()
    let fresh: NostrEvent | null = null
    try { fresh = await loadFollowList(fetcher, who, PROFILE_KIND, { quick: false }) } catch { fresh = null } // every relay: a fast one with an old copy must not undo a recent change made elsewhere
    if (me !== who || aboutEdit !== e) return
    e.busy = false
    if (!fresh) { e.note = t(lang, 'aboutNoProfile'); return draw() } // never publish a profile from nothing: it would erase the real one
    if (myProfile && fresh.id !== myProfile.id) { myProfile = fresh; e.note = t(lang, 'aboutChanged'); return draw() } // changed elsewhere meanwhile: look again before saving
    myProfile = fresh
    const template = aboutTemplate(fresh, text, nowSec())
    if (!template) { if (aboutOf(fresh) === text) { aboutEdit = null; say('info', t(lang, 'aboutSame')) } else e.note = problemText(lang, 'profile'); return draw() }
    aboutEdit = null
    if (await send(template, { profileBase: fresh })) {
      let confirmed = false
      for (const wait of deps.verifyWaitsMs ?? [1500, 3000]) {
        await new Promise((r) => setTimeout(r, wait))
        try { fetcher.clear(); const after = await loadFollowList(fetcher, who, PROFILE_KIND); if (after) { myProfile = after; confirmed = aboutOf(after) === text } } catch { confirmed = false }
        if (confirmed) break
      }
      if (result && !failedRelays(result.outcomes).length) result = null
      say('info', t(lang, confirmed ? 'aboutSaved' : 'aboutUnconfirmed'), confirmed ? undefined : 7000)
    } else aboutEdit = { ...e, text, busy: false }
    draw()
  }

  /** Wide screens: Following, Mentions and Me side by side, each scrolling on its own, and a panel on the right for the thread, account or list you opened. */
  function wideView(route: Route, signArea: HTMLElement | null, signOut: HTMLElement): HTMLElement {
    const column = (id: 'following' | 'mentions' | 'me', title: string, nodes: (Node | null)[], extra: (Node | null)[] = []) =>
      h('section', { class: 'col', 'data-col': id }, h('h2', { class: 'col-title' }, h('span', {}, title), ...extra), ...nodes)
    const write = signer?.state === 'connected' ? h('button', { type: 'button', class: 'primary write', onClick: startNote }, icon('feather', 16), t(lang, 'newNote').replace(/…$/, '')) : null
    const count = badge > 0 ? h('span', { class: 'badge', 'aria-label': `${badge}` }, badge > 9 ? '9+' : String(badge)) : null
    const detailOpen = route.name === 'note' || route.name === 'user' || route.name === 'people'
    const detailTitle = route.name === 'note' ? t(lang, 'thread') : route.name === 'people' ? t(lang, route.list === 'following' ? 'peopleFollowing' : 'peopleFollowers') : t(lang, 'account')
    return h('div', { class: detailOpen ? 'cols with-detail' : 'cols' },
      column('following', t(lang, 'following'), [panes.following.body], [write]),
      column('mentions', t(lang, 'mentions'), [panes.mentions.body], [count]),
      route.name === 'search' ? h('section', { class: 'col search-col' }, h('h2', { class: 'col-title' }, h('span', {}, t(lang, 'search')), h('button', { type: 'button', class: 'icon close', 'aria-label': t(lang, 'dismiss'), title: t(lang, 'dismiss'), onClick: () => deps.setHash('') }, '×')), searchPage()) // the search takes the place of Me: four columns would squeeze the others
      : column('me', t(lang, 'me'), [accountCard(), installHint(deps.env ?? { ios: false, standalone: true }) ? h('section', { class: 'card install' }, h('h2', {}, t(lang, 'installTitle')), h('p', { class: 'meta' }, t(lang, 'installHint'))) : null, signArea, h('h2', { class: 'section' }, t(lang, 'myNotes')), panes.me.body, h('div', { class: 'foot' }, signOut)]),
      detailOpen ? h('section', { class: 'col detail', 'data-col': 'detail' }, h('h2', { class: 'col-title' }, h('span', {}, detailTitle), h('button', { type: 'button', class: 'icon close', 'aria-label': t(lang, 'dismiss'), title: t(lang, 'dismiss'), onClick: () => deps.setHash('') }, '×')), panes.detail.body) : null)
  }

  function draw(): void {
    // <main> is the only thing that scrolls and it is rebuilt on every draw. Read where the reader was FIRST: building the new one moves the list out of
    // the old one, which then collapses to zero.
    const kept = root.querySelector('main.view')?.scrollTop ?? 0
    const searching = !!searchInput && root.ownerDocument.activeElement === searchInput // read before building: moving the search page into the new view takes the cursor away
    const editingAbout = !!aboutBox && root.ownerDocument.activeElement === aboutBox
    const keptCols = new Map<string, number>([...root.querySelectorAll<HTMLElement>('.col[data-col]')].map((c) => [c.dataset.col!, c.scrollTop]))
    const route = parseRoute(deps.location.hash)
    const isWide = wide() && !!me && route.name !== 'settings' && route.name !== 'help'
    if (confirmingDisconnect && ((route.name !== 'me' && !isWide) || signer?.state !== 'connected')) confirmingDisconnect = false // a question left behind is forgotten
    if (confirmingSignOut && ((route.name !== 'me' && !isWide) || !me)) confirmingSignOut = false
    if (shareConfirm && signer?.state !== 'connected') shareConfirm = null
    if (deleteConfirm && signer?.state !== 'connected') deleteConfirm = null
    if (followFlow && signer?.state !== 'connected') followFlow = null
    const tab = (name: 'following' | 'mentions' | 'me', href: string) => h('a', { href, class: route.name === name ? 'tab on' : 'tab', 'data-tab': name, ...(route.name === name ? { 'aria-current': 'page' } : {}), onClick: (e: Event) => { if (route.name === name) { e.preventDefault(); refresh() } } }, icon(name === 'following' ? 'people' : name === 'mentions' ? 'at' : 'person', 18), t(lang, name), name === 'mentions' && badge > 0 ? h('span', { class: 'badge', role: 'status', 'aria-label': t(lang, 'newItems', { n: badge }) }, badge > 9 ? '9+' : String(badge)) : null)
    const input = h('input', { type: 'text', placeholder: t(lang, 'loginPlaceholder'), autocomplete: 'off', spellcheck: 'false', 'aria-label': t(lang, 'loginTitle') })
    const loginForm = h('form', { class: 'login card', onSubmit: (e: Event) => { e.preventDefault(); login(input.value) } },
      h('p', { class: 'tagline' }, t(lang, 'tagline')), h('h2', {}, t(lang, 'loginTitle')), h('p', {}, t(lang, 'loginHelp')), input, ' ', h('button', { type: 'submit', class: 'primary' }, t(lang, 'loginButton')),
      loginError ? h('p', { class: 'error', role: 'alert' }, loginError) : null)
    const signArea = signer ? renderSignArea({
      emojiPicker: isWide, signer: signer.state, who: who() || (signer.pubkey ? shortNpub(signer.pubkey) : null), connect, connectOpen, flash, composer, review, step, result, relays, bunkerText, linkOpen, confirmDisconnect: confirmingDisconnect, shareConfirm, deleteConfirm, followPanel: followPanel(),
    }, {
      openConnect, startLink, pasteBunker: () => void pasteBunker(), cancelConnect, bunker: (x) => void bunker(x), dismissFlash: () => { flash = null; draw() }, confirmFollow: () => void confirmFollow(), acceptList, cancelFollow: () => { followFlow = null; draw() }, confirmShare: () => void share(), startQuote: () => { if (shareConfirm) startQuote(shareConfirm) }, cancelShare: () => { shareConfirm = null; draw() }, confirmDelete: () => void deleteNote(), cancelDelete: () => { deleteConfirm = null; draw() }, askDisconnect: () => { confirmingDisconnect = true; draw() }, cancelDisconnect: () => { confirmingDisconnect = false; draw() },
      disconnect: () => { confirmingDisconnect = false; void signer.disconnect(); composer = review = result = null; flash = null; draw() }, copy: (x) => { deps.copy?.(x); say('info', t(lang, 'copied')); draw() },
      edit: (x) => { if (composer) composer.text = x }, review: doReview, publish: () => void publish(), back: () => { review = null; draw() }, cancelComposer: () => { composer = null; review = null; draw() },
      retry: () => void retry(), dismissResult: () => { result = null; draw() }, startNote, cancelSigning: () => signing?.abort(),
      editBunker: (x) => { bunkerText = x }, setLinkOpen: (o) => { linkOpen = o },
    }, view(), true, !me || route.name === 'me' || isWide ? 'me' : 'feed', !!me && !isWide && ['following', 'mentions', 'note', 'user', 'me', 'people'].includes(route.name)) : null
    const pills = h('div', { class: 'lang', role: 'group', 'aria-label': 'Language' }, ...(['en', 'es'] as const).map((l) =>
      h('button', { type: 'button', 'aria-pressed': String(lang === l), onClick: () => { if (lang !== l) { lang = l; safeSet(kv, 'lang', lang); void load() } } }, l.toUpperCase())))
    const statusEl = me && status ? h('p', { class: 'status loading', role: 'status' }, h('span', {}, status)) : null
    const doSignOut = () => { confirmingSignOut = false; safeSet(kv, feedCacheKey(), null); me = null; session = null; body = null; shownRoute = ''; forgetAccount(); safeSet(kv, 'me', null); void signer?.disconnect(); composer = review = result = null; flash = null; deps.setHash(''); draw() }
    const signOut = confirmingSignOut
      ? h('div', { class: 'confirm-signout', role: 'alertdialog', 'aria-label': t(lang, 'signOut') }, h('p', {}, t(lang, 'confirmSignOut')),
        h('p', { class: 'buttons' }, h('button', { type: 'button', class: 'danger', onClick: doSignOut }, t(lang, 'signOut')), ' ', h('button', { type: 'button', onClick: () => { confirmingSignOut = false; draw() } }, t(lang, 'cancel'))))
      : h('button', { type: 'button', class: 'danger', onClick: () => { confirmingSignOut = true; draw() } }, t(lang, 'signOut'))
    const helpPage = renderHelp(view(), helpOpen, (id, isOpen) => { if (isOpen) helpOpen.add(id); else helpOpen.delete(id) })
    const content: (HTMLElement | null)[] = route.name === 'help' ? [signArea, helpPage]
      : !me ? [...(route.name === 'note' && guestBody ? [guestBody] : []), loginForm, signArea]
      : route.name === 'settings' ? [signArea, renderPrefs({ font, avatars: avatarStyle, sampleKey: me!, onAvatars: changeAvatars, scheme, onScheme: changeScheme, halloween: halloween(), onHalloween: changeTheme, autoImages, onAutoImages: changeAutoImages, interests, onInterests: changeInterests, reposts: showReposts, onReposts: changeReposts, relays, isDefault: sameList(relays, defaultRelays), error: relayError, probe: probes, onFont: changeFont, onAdd: onAddRelay, onRemove: (u) => changeRelays(removeRelay(relays, u)), onTest: onTestRelay, onReset: () => changeRelays(defaultRelays),
        list: { state: listState(published, relays), publishedCount: published?.length ?? 0, canSign: signer?.state === 'connected', confirming: confirmingList },
        onAskPublish: () => { confirmingList = true; draw() }, onCancelPublish: () => { confirmingList = false; draw() }, onPublish: () => void publishList(), onUsePublished: () => { if (published) changeRelays(published) } }, view()), renderSettings({ settings, words, graph: session ? { ...session.graphInfo, loaded: session.graphInfo.graph.loaded } : null, onSettings: changeSettings, onWords: changeWords }, view())]
      : isWide ? [wideView(route, signArea, signOut)]
      : route.name === 'me' ? [accountCard(), installHint(deps.env ?? { ios: false, standalone: true }) ? h('section', { class: 'card install' }, h('h2', {}, t(lang, 'installTitle')), h('p', { class: 'meta' }, t(lang, 'installHint'))) : null, signArea, h('h2', { class: 'section' }, t(lang, 'myNotes')), body, h('div', { class: 'foot' }, signOut)]
      : [signArea, body]
    const page: (HTMLElement | null)[] = [
      h('header', { class: 'top' }, halloween() ? h('span', { class: 'cobweb', 'aria-hidden': 'true' }, cobweb()) : null, updateReady ? h('div', { class: 'update', role: 'status' }, h('span', {}, t(lang, 'updateAvailable')), h('button', { type: 'button', class: 'primary', ...(busy ? { disabled: true } : {}), onClick: () => deps.reload?.() }, t(lang, 'updateNow'))) : null, h('div', { class: 'brand' }, h('h1', {}, h('a', { href: '#/', class: 'wordmark' }, logo(26, halloween()), 'Quill', halloween() ? pumpkin(22) : null)), h('span', { class: 'tag' }, t(lang, 'tagline'))), me && wide() ? h('button', { type: 'button', class: route.name === 'search' ? 'icon on' : 'icon', 'aria-label': t(lang, 'search'), title: t(lang, 'search'), 'aria-pressed': String(route.name === 'search'), onClick: () => deps.setHash(route.name === 'search' ? '' : '#/search') }, icon('search', 18)) : null, me ? h('button', { type: 'button', class: status ? 'icon spinning' : 'icon', 'aria-label': t(lang, 'refresh'), title: t(lang, 'refresh'), ...(status ? { 'aria-busy': 'true' } : {}), onClick: refresh }, icon('refresh', 18)) : null, pills, me ? h('button', { type: 'button', class: route.name === 'settings' ? 'icon on' : 'icon', 'aria-label': t(lang, 'prefsTitle'), title: t(lang, 'prefsTitle'), 'aria-pressed': String(route.name === 'settings'), onClick: () => deps.setHash(route.name === 'settings' ? '' : '#/settings') }, icon('gear', 18)) : null, h('button', { type: 'button', class: route.name === 'help' ? 'icon on' : 'icon', 'aria-label': t(lang, 'helpTitle'), title: t(lang, 'helpTitle'), 'aria-pressed': String(route.name === 'help'), onClick: () => deps.setHash(route.name === 'help' ? '' : '#/help') }, icon('help', 18)), statusEl),
      // the search button lives inside <main>, like the write button: on iOS the scrolling <main> is a layer of its own, and a button outside it would cover the notices shown inside it
      h('main', { class: isWide ? 'view wide' : 'view' }, ...content, me && !isWide && route.name !== 'search' && route.name !== 'settings' && route.name !== 'help' ? h('button', { type: 'button', class: 'fab-search', 'aria-label': t(lang, 'search'), title: t(lang, 'search'), onClick: () => deps.setHash('#/search') }, icon('search', 26)) : null),
      me && !isWide ? h('nav', { class: 'tabbar' }, tab('following', '#/'), tab('mentions', '#/mentions'), tab('me', '#/me')) : null,
    ]
    // put the reader back where they were (unless this is a new view)
    if (scrollToTop || flash || composer || review || result || followFlow || shareConfirm || deleteConfirm || connectOpen) barsHidden = false // a new view, or something that talks to you: the bars stay
    root.replaceChildren(...page.filter((x): x is HTMLElement => x !== null))
    if (searching && searchInput!.isConnected) searchInput!.focus({ preventScroll: true })
    if (editingAbout && aboutBox?.isConnected) aboutBox.focus({ preventScroll: true })
    root.classList.toggle('bars-hidden', barsHidden && !isWide)
    root.classList.toggle('wide', isWide)
    root.classList.toggle('has-tabs', !!me && !isWide)
    root.classList.toggle('wide-screen', wide()) // the screen is wide, whatever page is shown: the header keeps its place
    for (const c of root.querySelectorAll<HTMLElement>('.col[data-col]')) {
      const id = c.dataset.col as keyof typeof panes
      c.scrollTop = panes[id].resetScroll ? 0 : keptCols.get(id) ?? 0
      if (panes[id].body) panes[id].resetScroll = false // the new view is on screen: from now on the reader's place is kept
    }
    const main = root.querySelector('main.view')
    if (main && !isWide) main.scrollTop = scrollToTop ? 0 : kept
    if (main && !isWide) {
      let last = main.scrollTop
      main.addEventListener('scroll', () => {
        const top = main.scrollTop, d = top - last
        if (Math.abs(d) < SCROLL_STEP_PX) return // small moves do not count; a slow drag adds up because `last` stays
        last = top
        const hide = d > 0 && top > HIDE_AFTER_PX
        if (hide !== barsHidden) { barsHidden = hide; root.classList.toggle('bars-hidden', hide) }
      }, { passive: true })
    }
    // coming from "Filter settings": land on the filter section, not at the top of Settings
    if (scrollToTop && route.name === 'settings' && route.focus === 'filter') root.querySelector('.settings')?.scrollIntoView({ block: 'start' })
    scrollToTop = false
  }

  deps.onHash(() => { void load('route') })
  deps.onSchemeChange?.(() => { if (scheme === 'auto') { applyTheme(); draw() } })
  deps.onWide?.(() => { shownRoute = ''; barsHidden = false; root.classList.remove('bars-hidden'); void load() })
  // Coming back to the app after a while (an installed app stays alive in the background): show fresh notes, not what was there hours ago.
  deps.onVisible?.(() => { void checkUpdate(); if (me && !busy && (deps.nowMs?.() ?? Date.now()) - lastLoadAt > 120_000) refresh() })
  deps.onTick?.(() => { void checkUpdate() })
  deps.onPoll?.(() => { if (!busy) void poll() })
  void checkUpdate()
  draw()
  void load()
}
export type { Key }
