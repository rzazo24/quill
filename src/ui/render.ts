// Turning judged notes into DOM. Pure of state: give it data, get elements. Nothing here loads anything external.
import { nip19 } from 'nostr-tools'
import { interestsIn } from '../core/interests.js'
import { formatSats } from '../core/zap.js'
import { markdownBlocks } from '../core/markdown.js'
import { articleInfo, type ArticleInfo } from '../data/article.js'
import { COMMENT_KIND } from '../core/thread.js'
import type { Child } from './dom.js'
import type { TrustReason, TrustScore } from '../data/trust.js'
import { h, menuKeys } from './dom.js'
import { ARTICLE_KIND, primalArticle, refs, shortNpub } from '../core/refs.js'
import { avatarOf } from '../core/avatar.js'
import { showReaction, type ReactionGroup } from '../data/activity.js'
import type { ProfileInfo } from '../data/profile.js'
import { AVATAR_STYLES, FONT_SIZES, SCHEMES, type Scheme, type AvatarStyle, type FeedMode, type FontSize } from './store.js'
import { robotEl } from './robot-el.js'
import { pixelEl } from './pixel-el.js'
import { spookyEl } from './spooky-el.js'
import { HELP, helpBlocks } from './help-text.js'
import type { ListState } from '../data/relaylist.js'
import { icon } from './icons.js'
import { cleanText, segments } from '../core/text.js'
import type { Judged, RuleId, Settings } from '../core/verdict.js'
import { noteId, noteLink } from '../core/compose.js'
import type { ThreadNode } from '../data/feed.js'
import { hasReach, reactionTotal, type Reach } from '../data/reach.js'
import { ago, otherKind, reason, t, tallyLabel, type Lang } from './i18n.js'

export interface View { lang: Lang; names: ReadonlyMap<string, string>; nowMs?: number; /** What the round pictures are made of (default: initials). */ avatars?: AvatarStyle; /** The Halloween theme is on: extra reactions. */ halloween?: boolean; /** What a note of the reader's got from others (reactions, reposts, replies), once it is known. */ reach?: (id: string) => Reach | undefined; /** A note quoted in a text, once it is known (undefined: not yet asked; null: not found); `wantQuote` asks for it. */ quoted?: (id: string) => Judged | null | undefined; wantQuote?: (id: string, relays?: string[]) => void; /** An article's title once it is known (undefined: not asked yet; null: not found); `wantArticle` asks for it. */ articleTitle?: (pubkey: string, identifier: string) => string | null | undefined; wantArticle?: (pubkey: string, identifier: string, relays?: string[]) => void; /** Pictures linked in a note by this author load by themselves (the reader's setting); otherwise each waits for a tap. */ autoImages?: (pubkey: string) => boolean; /** Inside a quoted note (itself one link): addresses are plain text, no links or buttons inside the link. */ plainLinks?: boolean; /** Told about every note handed to a list or drawn, so the search can find it later. */ seen?: (notes: Judged[]) => void; /** The topics the reader cares about: a note that talks about one is marked. */ interests?: readonly string[]; /** With a signer: the "…" menu offers to mute (or unmute) the author. */ mute?: (pubkey: string) => void; isMuted?: (pubkey: string) => boolean; /** With a signer: the "…" of the reader's own notes offers to delete them. */ deleteNote?: (e: Judged['event']) => void; /** One of the reader's notes is on screen without its numbers: ask for them (the view batches the questions). */ wantReach?: (id: string) => void; /** A real profile picture for this key, when the reader wants them and follows it (undefined: the drawn avatar). */ picture?: (pubkey: string, px: number) => string | undefined; /** The zaps of someone else's note, once asked (undefined: not known yet; asking is the view's business). */ zapsOf?: (id: string) => Reach | undefined; /** Notes the reader deleted: shown as a line that says so. */ deleted?: ReadonlySet<string>; /** The reader's key: their own notes offer Delete, the others Mute. */ self?: string; /** Notes saved for later (this device): the "…" offers Save / Remove. */ saved?: { has: (id: string) => boolean; toggle: (e: Judged['event']) => void }; /** Accounts to offer while typing "@name" in the composer (people you follow first). */ suggestPeople?: (word: string) => { pubkey: string; name: string; relation: 'follow' | 'network' | 'none' }[]; actions?: (j: Judged) => Child[]; /** Copies a text (a note's id or link) for the "…" menu of each note; without it the menu is not offered. */ copy?: (text: string) => void; /** The relays put in a copied id/link as places to look for the note. */ hints?: readonly string[]; /** How far "Show more" went in each list, by its key. */ pages?: Map<string, number>; /** Notes that arrived after the reader's last visit are marked. */ isNew?: (e: Judged['event']) => boolean }

export const nameOf = (v: View, pubkey: string): string => v.names.get(pubkey) ?? shortNpub(pubkey)

/** Where an account's page is. */
export const userHref = (pubkey: string): string => `#/user/${pubkey}`
const isKey = (k: string) => /^[0-9a-f]{64}$/.test(k)

/** The text of a note: plain text, readable references to people and notes, and links shown in full. Never markup. */
/** The way to a thread: "Thread" in a note's header (this note's conversation) and "Quoted note" where the text points at another note, so the two are never confused. */
export function threadChip(href: string, v: View, label: 'thread' | 'quotedNote' = 'thread'): HTMLElement {
  return h('a', { class: 'thread-link', href }, icon('thread', 14), t(v.lang, label))
}

/** `fromId`: the note this text belongs to; a quoted-note chip carries it so the page it opens can show where you came from. */
/** A quoted note shown inside the one that quotes it: its author and its text (a quote inside it stays a button: no endless nesting). Judged like any note:
 *  if the filter hides it, only the reason is shown. A tap opens it. */
export const POLL_KIND = 1068
function quoteCard(j: Judged, v: View, href: string, vouch: string[]): HTMLElement {
  const inner: View = { ...v, quoted: undefined, wantQuote: undefined, plainLinks: true }
  const head = h('span', { class: 'quote-head' }, avatarEl(j.event.pubkey, v), h('strong', {}, nameOf(v, j.event.pubkey)), ' ', h('time', { datetime: new Date(j.event.created_at * 1000).toISOString() }, ago(v.lang, j.event.created_at, v.nowMs)))
  // notes and comments are text; a long-form article shows its title and summary; anything else is named, not shown (its content may not be text at all)
  if (j.event.kind === ARTICLE_KIND) {
    const info = articleInfo(j.event)
    return h('a', { class: 'quote', href: `#/article/${nip19.naddrEncode({ kind: ARTICLE_KIND, pubkey: j.event.pubkey, identifier: j.event.tags.find((x) => x[0] === 'd')?.[1] ?? '', relays: [] })}` }, head, h('span', { class: 'quote-body' }, h('span', { class: 'poll-tag meta' }, t(v.lang, 'article')), h('strong', {}, info.title || t(v.lang, 'article')), info.summary ? h('span', { class: 'quote-summary' }, ' ', info.summary.slice(0, 200)) : null))
  }
  if (j.event.kind !== 1 && j.event.kind !== COMMENT_KIND && j.event.kind !== POLL_KIND) return h('div', { class: 'quote' }, head, h('span', { class: 'quote-body meta' }, otherKind(v.lang, j.event.kind)))
  if (j.event.kind === POLL_KIND) { // a poll (NIP-88): its question and its options, as text; voting is for another client (it opens nowhere here)
    const options = j.event.tags.filter((x) => x[0] === 'option' && x[2]).slice(0, 12).map((x) => h('li', {}, x[2]!))
    return h('div', { class: 'quote' }, head, j.verdict.hidden ? h('span', { class: 'quote-hidden' }, `${t(v.lang, 'hiddenBy')}: `, reason(v.lang, j.verdict)) : h('span', { class: 'quote-body' }, h('span', { class: 'poll-tag meta' }, t(v.lang, 'poll'), ' · ', t(v.lang, 'pollElsewhere')), renderContent(j.event.content, inner, undefined, [j.event.pubkey, ...vouch]), options.length ? h('ul', { class: 'poll-options' }, ...options) : null))
  }
  return h('a', { class: 'quote', href }, head, j.verdict.hidden ? h('span', { class: 'quote-hidden' }, `${t(v.lang, 'hiddenBy')}: `, reason(v.lang, j.verdict)) : h('span', { class: 'quote-body' }, renderContent(j.event.content, inner, undefined, [j.event.pubkey, ...vouch])))
}

/** A link to a picture (an https address ending in a picture's extension). */
export const isImageUrl = (href: string): boolean => { try { const u = new URL(href); return u.protocol === 'https:' && /\.(jpe?g|png|gif|webp|avif)$/i.test(u.pathname) } catch { return false } }
/** The site a picture or video comes from, short enough for a button: a very long name (some hosts put a whole key in it) keeps only its end. */
const shortHost = (href: string): string => { const n = new URL(href).hostname; return n.length > 28 ? '…' + n.split('.').slice(-2).join('.') : n }
/** A link inside a quoted note (itself one link, so nothing in it can be tapped on its own): a picture shows itself if it would load by itself, else
 *  a short "[picture · site]"; a video says "[video · site]"; any other address stays as text. */
function plainLink(href: string, text: string, v: View, auto: boolean): HTMLElement {
  if (isImageUrl(href) && auto) return h('span', { class: 'pic' }, h('img', { src: href, alt: t(v.lang, 'imageAlt', { host: shortHost(href) }), loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }))
  if (isImageUrl(href) || isVideoUrl(href)) return h('span', { class: 'meta' }, `[${t(v.lang, isImageUrl(href) ? 'imageWord' : 'videoWord')} · ${shortHost(href)}]`)
  return h('span', { class: 'ext' }, text)
}
/** Pictures the reader asked for in this visit: they stay open when the page is drawn again. */
const shownImages = new Set<string>()
/** A picture linked in a note. Quill keeps no copy: the reader's browser asks the site where it lives, which sees their IP address, so by default
 *  it waits for a tap on a button that names that site. Open, it shows the picture (a tap opens it whole) and where it came from. */
function imageEl(href: string, v: View, auto: boolean): HTMLElement {
  const host = shortHost(href)
  const box = h('span', { class: 'pic' })
  const show = () => {
    shownImages.add(href)
    const img = h('img', { src: href, alt: t(v.lang, 'imageAlt', { host }), loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }) as HTMLImageElement
    img.addEventListener('error', () => box.replaceChildren(h('a', { class: 'ext', href, rel: 'noopener noreferrer nofollow', target: '_blank', onclick: (e: Event) => e.stopPropagation() }, href), ' ', h('span', { class: 'meta' }, t(v.lang, 'imageFailed'))))
    box.replaceChildren(h('a', { class: 'pic-open', href, rel: 'noopener noreferrer nofollow', target: '_blank', onclick: (e: Event) => e.stopPropagation() }, img), h('span', { class: 'pic-host meta' }, host))
  }
  if (auto || shownImages.has(href)) show()
  else box.append(h('button', { type: 'button', class: 'thread-link pic-btn', onclick: (e: Event) => { e.stopPropagation(); show() } }, icon('image'), `${t(v.lang, 'showImage')} · ${host}`))
  return box
}

/** A link to a video file (https, ending in a video's extension). Pages like YouTube are not: showing them inside would load their code and tracking. */
export const isVideoUrl = (href: string): boolean => { try { const u = new URL(href); return u.protocol === 'https:' && /\.(mp4|webm|mov|m4v)$/i.test(u.pathname) } catch { return false } }
/** Videos the reader started in this visit. The element itself is kept and put back when the page is drawn again, so a video that is playing goes on. */
const shownVideos = new Map<string, HTMLElement>()
/** A video linked in a note: never loads by itself (not even with the pictures setting: it weighs far more), only after a tap on a button naming its site,
 *  and then plays there, straight from that site (Quill keeps no copy). */
function videoEl(href: string, v: View): HTMLElement {
  const kept = shownVideos.get(href)
  if (kept) return kept
  const host = shortHost(href)
  const box = h('span', { class: 'pic vid', onclick: (e: Event) => e.stopPropagation() })
  const show = () => {
    const vid = h('video', { src: href, controls: '', playsinline: '', preload: 'metadata', 'aria-label': t(v.lang, 'videoAlt', { host }) }) as HTMLVideoElement
    vid.addEventListener('error', () => box.replaceChildren(h('a', { class: 'ext', href, rel: 'noopener noreferrer nofollow', target: '_blank' }, href), ' ', h('span', { class: 'meta' }, t(v.lang, 'videoFailed'))))
    box.replaceChildren(vid, h('span', { class: 'pic-host meta' }, host))
    shownVideos.set(href, box)
    void vid.play()?.catch(() => {}) // the tap was the reader's choice; if the phone still says no, the controls are there
  }
  box.append(h('button', { type: 'button', class: 'thread-link pic-btn', onclick: (e: Event) => { e.stopPropagation(); show() } }, icon('video'), `${t(v.lang, 'showVideo')} · ${host}`))
  return box
}

/** `vouch`: the author, and whoever brought the note to the reader (a followed account that reposted it or quotes it). Its pictures load by themselves
 *  (with the setting on) when any of them is followed. */
export function renderContent(raw: string, v: View, fromId?: string, vouch: string[] = []): DocumentFragment {
  const frag = document.createDocumentFragment()
  const auto = vouch.some((k) => !!v.autoImages?.(k))
  for (const part of refs(cleanText(raw, 4000))) {
    if (part.type === 'person') frag.append(v.plainLinks ? h('span', { class: 'ref' }, '@' + nameOf(v, part.pubkey)) : h('a', { class: 'ref', href: userHref(part.pubkey) }, '@' + nameOf(v, part.pubkey)))
    else if (part.type === 'article') {
      const title = v.articleTitle?.(part.pubkey, part.identifier)
      if (title === undefined) v.wantArticle?.(part.pubkey, part.identifier, part.relays)
      const label = title ? `${t(v.lang, 'readArticle')}: ${title}` : t(v.lang, 'article')
      frag.append(v.plainLinks ? h('span', { class: 'meta' }, `[${label}]`) : h('a', { class: 'thread-link article-link', href: `#/article/${part.naddr}` }, icon('article', 14), label))
    }
    else if (part.type === 'other') frag.append(h('span', { class: 'meta other-kind' }, `[${otherKind(v.lang, part.kind)}]`))
    else if (part.type === 'note' && v.plainLinks) frag.append(h('span', { class: 'meta' }, `[${t(v.lang, 'quotedNote')}]`))
    else if (part.type === 'note') {
      const href = `#/note/${part.id}${fromId && fromId !== part.id ? `?from=${fromId}` : ''}`, q = v.quoted?.(part.id)
      if (q === undefined) v.wantQuote?.(part.id, part.relays)
      frag.append(q ? quoteCard(q, v, href, vouch) : threadChip(href, v, 'quotedNote')) // the quoted note itself, inside; until it is known (or if no relay has it), the button to it
    }
    else for (const seg of segments(part.value)) {
      frag.append(seg.type !== 'link' ? seg.value : v.plainLinks ? plainLink(seg.href, seg.value, v, auto) : isImageUrl(seg.href) ? imageEl(seg.href, v, auto) : isVideoUrl(seg.href) ? videoEl(seg.href, v) : h('a', { class: 'ext', href: seg.href, rel: 'noopener noreferrer nofollow', target: '_blank' }, seg.value))
      const d = seg.type === 'link' && !v.plainLinks && vouch[0] ? primalArticle(seg.href) : null
      if (d) { // an article shared as a Primal address: if its author really has one by that name, offer to read it here
        const title = v.articleTitle?.(vouch[0]!, d)
        if (title === undefined) v.wantArticle?.(vouch[0]!, d)
        if (title) frag.append(' ', h('a', { class: 'thread-link article-link', href: `#/article/${nip19.naddrEncode({ kind: 30023, pubkey: vouch[0]!, identifier: d, relays: [] })}` }, icon('article', 14), `${t(v.lang, 'readArticle')}: ${title}`))
      }
    }
  }
  return frag
}

/** A round picture: colour and initials, or a robot, or a pixel figure drawn from the key. Nothing is loaded. The colour goes in through the style object (CSSOM),
 *  which the page's CSP allows. */
/** Pictures already shown, and pictures that failed (for this visit): a redraw reuses what is known instead of flashing or trying again. */
const loadedPictures = new Set<string>(), failedPictures = new Set<string>()

export function avatarEl(pubkey: string, v: View, size: 'md' | 'lg' = 'md', chosen?: AvatarStyle): HTMLElement {
  const style: AvatarStyle = chosen ?? v.avatars ?? 'initials'
  // a real picture only when the reader turned them on, for someone they follow (decided by the view); a sample in Settings (an explicit style) never
  const pic = chosen ? undefined : v.picture?.(pubkey, size === 'lg' ? 192 : 96)
  if (pic && !failedPictures.has(pic)) {
    const box = h('span', { class: size === 'lg' ? 'avatar lg photo' : 'avatar photo', 'aria-hidden': 'true' })
    // not lazy: a few kilobytes each, and Safari is unreliable about lazy images inside a scrolling area. One already shown decodes at once on a redraw (no flash).
    const img = h('img', { src: pic, alt: '', decoding: loadedPictures.has(pic) ? 'sync' : 'async', referrerpolicy: 'no-referrer' }) as HTMLImageElement
    img.addEventListener('load', () => loadedPictures.add(pic))
    img.addEventListener('error', () => { failedPictures.add(pic); box.replaceWith(avatarEl(pubkey, v, size, style)) }) // it did not load: the drawn one, from now on without trying again
    box.append(img)
    return box
  }
  if (style !== 'initials') return h('span', { class: size === 'lg' ? 'avatar lg art' : 'avatar art', 'aria-hidden': 'true' }, style === 'robots' ? robotEl(pubkey) : style === 'halloween' ? spookyEl(pubkey) : pixelEl(pubkey))
  const a = avatarOf(pubkey, v.names.get(pubkey))
  const el = h('span', { class: size === 'lg' ? 'avatar lg' : 'avatar', 'aria-hidden': 'true' }, a.letters)
  el.style.setProperty('--h', String(a.hue))
  return el
}

/** A tap on the text of a note opens its conversation. Links, buttons and a text selection keep their own meaning, and the thread you are already in stays put. */
function openThread(e: Event, id: string): void {
  const target = e.target as Element | null
  if (target?.closest('a, button, summary, input, textarea, video, audio')) return
  if (String(window.getSelection?.() ?? '') !== '') return
  if (location.hash.startsWith(`#/note/${id}`)) return
  location.hash = `#/note/${id}`
}

/** The "…" of a note: a small menu with its text, its id and its link. It closes when a choice is made, on a tap anywhere else, or on Escape. */
function moreMenu(event: Judged['event'], v: View): HTMLElement | null {
  const copy = v.copy
  if (!copy) return null
  const box = h('span', { class: 'more-menu' })
  // the answer is on the choice itself (the page's message bar only exists with a signer): it says "Copied" for a moment, then the menu closes
  const choice = (label: string, text: () => string) => { const b = h('button', { type: 'button', role: 'menuitem', onClick: () => { copy(text()); b.textContent = t(v.lang, 'copied'); setTimeout(() => { close(); b.textContent = label }, 900) } }, label); return b }
  const own = !!v.self && event.pubkey === v.self
  const saveChoice = v.saved ? h('button', { type: 'button', role: 'menuitem', onClick: () => { close(); v.saved!.toggle(event) } }, t(v.lang, v.saved.has(event.id) ? 'unsaveNote' : 'saveNote')) : null
  const deleteChoice = v.deleteNote && own ? h('button', { type: 'button', role: 'menuitem', class: 'danger-text', onClick: () => { close(); v.deleteNote!(event) } }, t(v.lang, 'deleteNote')) : null
  const muteChoice = v.mute && !own ? h('button', { type: 'button', role: 'menuitem', class: 'danger-text', onClick: () => { close(); v.mute!(event.pubkey) } }, t(v.lang, v.isMuted?.(event.pubkey) ? 'unmuteWho' : 'muteWho', { who: nameOf(v, event.pubkey) })) : null
  const list = h('span', { class: 'more-list', role: 'menu' }, choice(t(v.lang, 'copyNoteText'), () => event.content), choice(t(v.lang, 'copyNoteId'), () => noteId(event, v.hints)), choice(t(v.lang, 'copyNoteLink'), () => noteLink(event, v.hints)), saveChoice, deleteChoice, muteChoice)
  const toggle = h('button', { type: 'button', class: 'more-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': t(v.lang, 'more'), title: t(v.lang, 'more'), onClick: () => (box.classList.contains('open') ? close() : open()) }, icon('more', 22))
  const away = (e: Event) => { if (!box.contains(e.target as Node)) close() }
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
  // with a keyboard: the focus goes to the first choice, arrows move, Escape gives it back to "…", and leaving the menu with Tab closes it
  function open() { box.classList.add('open'); toggle.setAttribute('aria-expanded', 'true'); list.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true }); setTimeout(() => { document.addEventListener('click', away); document.addEventListener('keydown', esc) }, 0) }
  function close() { box.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', away); document.removeEventListener('keydown', esc) }
  menuKeys(list, () => toggle, close)
  box.addEventListener('focusout', (e) => { const to = (e as FocusEvent).relatedTarget as Node | null; if (to && !box.contains(to)) close() })
  box.append(toggle, list)
  return box
}

/** Under a note of yours: what it got. Up to three emojis with their number, then the rest of the reactions as +N, the reposts and the replies. Nothing when it got nothing. */
export function reachLine(r: Reach | undefined, v: View, noteId?: string): HTMLElement | null {
  if (!hasReach(r)) return null
  const top = [...r.reactions].slice(0, 3), rest = reactionTotal(r) - top.reduce((a, [, n]) => a + n, 0), item = (...c: Child[]) => h('span', { class: 'reach-item' }, ...c)
  const many = (n: number, one: 'reachReactionsOne' | 'reachRepostsOne' | 'reachRepliesOne', other: 'reachReactions' | 'reachReposts' | 'reachReplies') => (n === 0 ? '' : n === 1 ? t(v.lang, one) : t(v.lang, other, { n }))
  const zapsSaid = r.zaps ? t(v.lang, r.zaps.count === 1 ? 'reachZapsOne' : 'reachZaps', { n: r.zaps.count, sats: formatSats(r.zaps.sats, v.lang) }) : ''
  const said = [many(reactionTotal(r), 'reachReactionsOne', 'reachReactions'), many(r.reposts, 'reachRepostsOne', 'reachReposts'), many(r.replies, 'reachRepliesOne', 'reachReplies'), zapsSaid].filter(Boolean).join(', ')
  const items = [...top.map(([emoji, n]) => item(emoji, ' ', String(n))), rest > 0 ? item(`+${rest}`) : null, r.reposts ? item(icon('repost', 14), ' ', String(r.reposts)) : null, r.replies ? (noteId && !r.who ? h('a', { class: 'reach-item reach-replies', href: `#/note/${noteId}` }, icon('thread', 14), ' ', String(r.replies)) : h('span', { class: 'reach-item reach-replies' }, icon('thread', 14), ' ', String(r.replies))) : null, r.zaps ? item(icon('zap', 14), ' ', formatSats(r.zaps.sats, v.lang)) : null]
  if (!r.who) return h('div', { class: 'reach', role: 'group', 'aria-label': said, title: said }, ...items)
  // a tap shows who: the people of each emoji and the reposters, each a link to the account; a tap right on the replies number opens the conversation
  const who = r.who
  const people = (keys: string[]) => h('span', { class: 'reach-people' }, ...keys.flatMap((k, i) => [i ? ', ' : '', h('a', { href: userHref(k) }, nameOf(v, k))]))
  const panel = h('div', { class: 'reach-who', hidden: true },
    ...who.reactions.map(([emoji, keys]) => h('p', {}, h('span', { class: 'reach-mark' }, emoji), people(keys))),
    who.reposts.length ? h('p', {}, h('span', { class: 'reach-mark' }, icon('repost', 14)), people(who.reposts)) : null,
    ...(who.zaps ?? []).map(([sender, sats]) => h('p', {}, h('span', { class: 'reach-mark' }, icon('zap', 14)), h('span', { class: 'reach-people' }, sender ? h('a', { href: userHref(sender) }, nameOf(v, sender)) : t(v.lang, 'zapNoName'), ` · ${t(v.lang, 'zapSats', { sats: formatSats(sats, v.lang) })}`))),
    r.replies && noteId ? h('p', {}, h('span', { class: 'reach-mark' }, icon('thread', 14)), h('a', { href: `#/note/${noteId}` }, t(v.lang, r.replies === 1 ? 'reachRepliesOne' : 'reachReplies', { n: r.replies }))) : null)
  const toggle = h('button', { type: 'button', class: 'reach', 'aria-expanded': 'false', 'aria-label': said, title: said, onClick: (e: Event) => { if (noteId && (e.target as Element).closest?.('.reach-replies')) { location.hash = `#/note/${noteId}`; return } panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden)) } }, ...items)
  return h('div', { class: 'reach-box' }, toggle, panel)
}

function card(j: Judged, v: View, extra: Child[] = []): HTMLElement {
  v.seen?.([j])
  const { event } = j
  if (v.deleted?.has(event.id)) return h('article', { class: 'note deleted', 'data-id': event.id }, h('p', { class: 'meta' }, t(v.lang, 'deletedNote')))
  const hits = v.interests?.length ? interestsIn(event, v.interests) : []
  return h('article', { class: ['note', v.isNew?.(event) ? 'new' : '', hits.length ? 'interesting' : ''].filter(Boolean).join(' '), 'data-id': event.id, ...(v.isNew?.(event) ? { 'data-new': t(v.lang, 'newMark') } : {}) },
    // the picture and the name both open the account; the picture is skipped by keyboards and screen readers (the name link says the same)
    isKey(event.pubkey) ? h('a', { class: 'avatar-link', href: userHref(event.pubkey), tabindex: '-1', 'aria-hidden': 'true' }, avatarEl(event.pubkey, v)) : avatarEl(event.pubkey, v),
    h('div', { class: 'note-main' },
      j.followedBy?.length ? h('p', { class: 'reposted' }, icon('people', 14), j.followedBy.length > 1 ? t(v.lang, 'followedByMany', { who: nameOf(v, j.followedBy[0]!), n: j.followedBy.length - 1 }) : t(v.lang, 'followedByOne', { who: nameOf(v, j.followedBy[0]!) })) : null,
      hits.length ? h('p', { class: 'interest' }, icon('star', 14), t(v.lang, 'interestIn', { topics: hits.join(', ') })) : null,
      j.talkedBy?.length ? h('p', { class: 'reposted' }, icon('thread', 14), j.talkedBy.length > 1 ? t(v.lang, 'talkedByMany', { who: nameOf(v, j.talkedBy[0]!), n: j.talkedBy.length - 1 }) : t(v.lang, 'talkedByOne', { who: nameOf(v, j.talkedBy[0]!) })) : null,
      j.pickedBy?.length ? h('p', { class: 'reposted' }, icon('people', 14), j.pickedBy.length > 1 ? t(v.lang, 'pickedByMany', { who: nameOf(v, j.pickedBy[0]!), n: j.pickedBy.length - 1 }) : t(v.lang, 'pickedByOne', { who: nameOf(v, j.pickedBy[0]!) })) : null,
      j.repostedBy?.length ? h('p', { class: 'reposted' }, icon('repost', 14), j.repostedBy.length > 1 ? t(v.lang, 'repostedMany', { who: nameOf(v, j.repostedBy[0]!), n: j.repostedBy.length - 1 }) : t(v.lang, 'repostedOne', { who: nameOf(v, j.repostedBy[0]!) })) : null,
      h('header', {},
        // name and time run together and may wrap onto two lines; the thread button stays at the top right, always
        h('span', { class: 'byline' },
          isKey(event.pubkey) ? h('a', { class: 'name-link', href: userHref(event.pubkey) }, h('strong', {}, nameOf(v, event.pubkey))) : h('strong', {}, nameOf(v, event.pubkey)), ' ',
          h('time', { datetime: new Date(event.created_at * 1000).toISOString() }, ago(v.lang, event.created_at, v.nowMs))),
        h('span', { class: 'head-end' }, threadChip(`#/note/${event.id}`, v), moreMenu(event, v)),
      ),
      h('div', { class: 'body tappable', onclick: (e: Event) => openThread(e, event.id) }, renderContent(event.content, v, event.id, [event.pubkey, ...(j.repostedBy ?? [])])),
      reachLine(event.pubkey === v.self ? v.reach?.(event.id) ?? (v.wantReach?.(event.id), undefined) : v.reach?.(event.id) ?? v.zapsOf?.(event.id), v, event.id),
      ...extra, ...(v.actions?.(j) ?? []),
    ),
  )
}

/** A shown note is a card. A hidden one is folded under the sentence that says why, and opens with a tap: nothing is ever lost. */
export function renderJudged(j: Judged, v: View, extra: Child[] = []): HTMLElement {
  if (!j.verdict.hidden) return card(j, v, extra)
  return h('details', { class: 'folded' },
    h('summary', {}, h('span', { class: 'why' }, `${t(v.lang, 'hiddenBy')}: `), reason(v.lang, j.verdict), ' ', h('span', { class: 'who' }, `(${nameOf(v, j.event.pubkey)})`)),
    card(j, v, extra),
  )
}

/** Notes come in pages: a phone should not build a hundred cards at once. */
export const PAGE = 30
/** `key`: names the list (Mentions, an account's notes…): how far "Show more" went is remembered under it, so drawing the list again (names, numbers or
 *  new notes arrived) does not fold back what the reader opened. */
export function renderList(items: Judged[], v: View, key?: string): HTMLElement {
  const box = h('section', { class: 'list' })
  v.seen?.(items)
  if (!items.length) { box.append(h('p', { class: 'empty' }, t(v.lang, 'empty'))); return box }
  let shown = 0
  const more = h('button', { type: 'button', class: 'more' }, '')
  // the next page comes on its own as the reader nears the end: a card a few before the last one is watched (the scrolling box clips the
  // button itself until it is on screen, so watching the button would only start once the reader got there). The button stays, for keyboards.
  const watch = typeof IntersectionObserver === 'function' ? new IntersectionObserver((seen) => { if (seen.some((x) => x.isIntersecting)) add(PAGE) }) : null
  // a mark, not the card: a card drawn again just as it was is swapped for its old node, and the watched one would be gone
  const mark = h('div', { class: 'more-mark', 'aria-hidden': 'true' })
  const add = (n: number) => {
    mark.remove()
    const cards = items.slice(shown, shown + n).map((j) => renderJudged(j, v))
    for (const c of cards) box.insertBefore(c, more)
    shown = Math.min(items.length, shown + n)
    if (key) v.pages?.set(key, Math.max(shown, v.pages.get(key) ?? 0))
    watch?.disconnect()
    if (shown >= items.length) more.remove(); else { more.textContent = t(v.lang, 'showMore', { n: items.length - shown }); const near = cards[Math.max(0, cards.length - 8)]; if (near && watch) { mark.remove(); box.insertBefore(mark, near); watch.observe(mark) } }
  }
  more.addEventListener('click', () => add(PAGE))
  box.append(more); add(Math.max(PAGE, key ? v.pages?.get(key) ?? 0 : 0))
  return box
}

export function renderTree(nodes: ThreadNode[], v: View, depth = 0): HTMLElement[] {
  return nodes.map((n) => h('div', { class: 'reply', 'data-depth': String(Math.min(depth, 6)) }, renderJudged(n.item, v), ...renderTree(n.children, v, depth + 1)))
}

/** "23 shown · 9 hidden" and what hid them, as the line above every list. */
export function renderSummary(tally: { shown: number; hidden: number; byRule: Partial<Record<RuleId, number>> }, v: View, onSettings: () => void): HTMLElement {
  const parts = Object.entries(tally.byRule).map(([rule, n]) => `${n} ${tallyLabel(v.lang, rule as RuleId)}`)
  return h('div', { class: 'summary', role: 'status' },
    h('span', { class: 'counts' },
      h('strong', {}, tally.hidden ? t(v.lang, 'hiddenSummary', { shown: tally.shown, hidden: tally.hidden }) : t(v.lang, 'hiddenNothing')),
      parts.length ? h('span', { class: 'parts' }, ` — ${parts.join(', ')}`) : null),
    h('button', { type: 'button', class: 'link', onClick: onSettings }, t(v.lang, 'filterSettings')),
  )
}

/** "Reactions to your notes": one line per note, who reacted and with what; a line is marked when something in it is new. */
export function renderReactionGroups(groups: ReactionGroup[], v: View): HTMLElement | null {
  if (!groups.length) return null
  return h('section', { class: 'reacted card' },
    h('h2', {}, t(v.lang, 'reactionsTitle')),
    h('ul', {}, ...groups.slice(0, 5).map((g) => {
      const who = nameOf(v, g.by[0]!)
      const said = g.by.length > 1 ? t(v.lang, 'reactedMany', { who, n: g.by.length - 1 }) : t(v.lang, 'reactedOne', { who })
      return h('li', {},
        h('a', { href: `#/note/${g.target.id}`, class: g.fresh ? 'reaction-line fresh' : 'reaction-line' },
          h('span', { class: 'emojis', 'aria-hidden': 'true' }, g.emojis.join(' ')),
          h('span', { class: 'what' }, h('strong', {}, said), h('q', {}, cleanText(g.target.content, 90).replace(/\s+/g, ' '))),
          g.fresh ? h('span', { class: 'dot', 'aria-label': t(v.lang, 'newMark') }) : null))
    })))
}

export interface SettingsPanelProps {
  settings: Settings
  words: string[]
  graph: { answered: number; total: number; loaded: boolean } | null
  onSettings: (s: Settings) => void
  onWords: (words: string) => void
}

/** "Reposts of your notes": one line per note, who shared it; a line is marked when something in it is new. */
export function renderRepostGroups(groups: ReactionGroup[], v: View): HTMLElement | null {
  if (!groups.length) return null
  return h('section', { class: 'reacted card' },
    h('h2', {}, t(v.lang, 'repostsTitle')),
    h('ul', {}, ...groups.slice(0, 5).map((g) => {
      const who = nameOf(v, g.by[0]!)
      const said = g.by.length > 1 ? t(v.lang, 'repostedYourMany', { who, n: g.by.length - 1 }) : t(v.lang, 'repostedYourOne', { who })
      return h('li', {}, h('a', { href: `#/note/${g.target.id}`, class: g.fresh ? 'reaction-line fresh' : 'reaction-line' },
        h('span', { class: 'emojis', 'aria-hidden': 'true' }, icon('repost', 18)),
        h('span', { class: 'what' }, h('strong', {}, said), h('q', {}, cleanText(g.target.content, 90).replace(/\s+/g, ' '))),
        g.fresh ? h('span', { class: 'dot', 'aria-label': t(v.lang, 'newMark') }) : null))
    })))
}

/** The head of an account's page: who it is, as text. */
/** `follow`: the Follow / Unfollow button (only offered with a signer connected, never for yourself). */
/** The account's npub, short; a tap copies the whole of it and says so for a moment. Without a way to copy, just the text. */
export function npubEl(pubkey: string, v: View): HTMLElement {
  const short = shortNpub(pubkey)
  if (!v.copy) return h('div', { class: 'meta' }, short)
  const b = h('button', { type: 'button', class: 'npub-copy meta', title: t(v.lang, 'copyNpub'), 'aria-label': `${t(v.lang, 'copyNpub')}: ${short}`, onClick: () => { v.copy!(nip19.npubEncode(pubkey)); b.textContent = t(v.lang, 'copied'); setTimeout(() => { b.textContent = short }, 1200) } }, short)
  return b
}

export function renderProfileHead(info: ProfileInfo, relation: 'you' | 'follow' | 'muted' | 'none', v: View, follow?: { following: boolean; muted: boolean; busy: boolean; onToggle: () => void; onMute: () => void }): HTMLElement {
  const rel = relation === 'you' ? 'profileYou' : relation === 'follow' ? 'profileFollowed' : relation === 'muted' ? 'profileMuted' : 'profileNotFollowed'
  const via = info.via.length > 1 ? t(v.lang, 'followedByMany', { who: nameOf(v, info.via[0]!), n: info.via.length - 1 }) : info.via.length === 1 ? t(v.lang, 'followedByOne', { who: nameOf(v, info.via[0]!) }) : null
  return h('section', { class: 'profile card' },
    h('div', { class: 'profile-top' }, avatarEl(info.pubkey, v, 'lg'),
      h('div', {}, h('h2', {}, nameOf(v, info.pubkey)), npubEl(info.pubkey, v), info.nip05 ? h('div', { class: 'meta' }, info.nip05) : null)),
    info.about ? h('div', { class: 'about' }, renderContent(info.about, v)) : null,
    info.website ? h('p', { class: 'meta' }, info.website) : null,
    h('p', { class: 'meta relation' }, [t(v.lang, rel), info.following === null ? null : t(v.lang, 'profileFollowing', { n: info.following })].filter(Boolean).join(' · ')),
    via ? h('p', { class: 'meta' }, via) : null,
    follow ? h('p', { class: 'buttons' }, h('button', { type: 'button', class: follow.following ? '' : 'primary', ...(follow.busy ? { disabled: true } : {}), onClick: follow.onToggle }, t(v.lang, follow.following ? 'unfollowButton' : 'followButton')), ' ',
      h('button', { type: 'button', class: follow.muted ? '' : 'danger', ...(follow.busy ? { disabled: true } : {}), onClick: follow.onMute }, t(v.lang, follow.muted ? 'unmuteButton' : 'muteButton'))) : null)
}

/** How much the network vouches for an account: the score out of 100, its level, and every point with its reason (folded), plus what it is not. */
export function renderTrust(tr: TrustScore | 'loading' | 'failed' | undefined, v: View): HTMLElement | null {
  if (!tr) return null
  if (tr === 'loading') return h('section', { class: 'card trust' }, h('h2', {}, t(v.lang, 'trustTitle')), h('p', { class: 'meta', role: 'status' }, t(v.lang, 'trustLoading')))
  if (tr === 'failed') return h('section', { class: 'card trust' }, h('h2', {}, t(v.lang, 'trustTitle')), h('p', { class: 'meta' }, t(v.lang, 'trustFailed')))
  const line = (r: TrustReason) => h('li', {}, h('span', { class: `trust-pts${r.points < 0 ? ' minus' : ''}` }, r.points < 0 ? `−${-r.points}` : `+${r.points}`), ' ', t(v.lang, `trust_${r.key}` as Parameters<typeof t>[1], r.n === undefined ? {} : { n: r.n }))
  return h('section', { class: `card trust ${tr.level}` },
    h('h2', {}, t(v.lang, 'trustTitle')),
    h('p', { class: 'trust-score' }, h('strong', {}, `${tr.score}/100`), ' · ', t(v.lang, `trustLevel_${tr.level}` as Parameters<typeof t>[1])),
    tr.reasons.length ? h('details', {}, h('summary', {}, t(v.lang, 'trustWhy')), h('ul', {}, ...tr.reasons.map(line))) : h('p', { class: 'meta' }, t(v.lang, 'trustNothing')),
    h('p', { class: 'meta' }, t(v.lang, 'trustNote')))
}

/** A long-form article, read as text: its title, author and date, its summary, and its Markdown as headings, paragraphs, lists, quotes and code.
 *  If the filter would hide its author, only the reason shows until the reader asks to read it anyway. */
export function renderArticle(e: Judged['event'], info: ArticleInfo, verdict: Judged['verdict'], v: View, opts: { showAnyway: boolean; onShow: () => void }): HTMLElement {
  const by = h('p', { class: 'meta article-by' }, h('a', { class: 'avatar-link', href: userHref(e.pubkey) }, avatarEl(e.pubkey, v)), h('a', { href: userHref(e.pubkey) }, nameOf(v, e.pubkey)), ' · ', h('time', { datetime: new Date(info.publishedAt * 1000).toISOString() }, new Date(info.publishedAt * 1000).toLocaleDateString(v.lang === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })))
  const head = [h('h2', { class: 'article-title' }, info.title || t(v.lang, 'article')), by, info.summary ? h('p', { class: 'article-summary' }, info.summary) : null]
  if (verdict.hidden && !opts.showAnyway) return h('article', { class: 'card article' }, ...head, h('p', { class: 'meta' }, `${t(v.lang, 'hiddenBy')}: `, reason(v.lang, verdict)), h('p', {}, h('button', { type: 'button', onClick: opts.onShow }, t(v.lang, 'readAnyway'))))
  const body: HTMLElement[] = []
  let list: HTMLElement | null = null
  v = { ...v, autoImages: () => true } // opening an article is already the reader's choice: its pictures load by themselves, whoever wrote it
  if (info.image) body.push(imageEl(info.image, v, true)) // the cover
  for (const b of markdownBlocks(e.content.slice(0, 100_000))) {
    if (b.type === 'item') { const want = b.ordered ? 'OL' : 'UL'; if (!list || list.tagName !== want) { list = h(b.ordered ? 'ol' : 'ul', {}); body.push(list) } list.append(h('li', {}, renderContent(b.text, v, undefined, [e.pubkey]))); continue }
    list = null
    if (b.type === 'heading') body.push(h(b.level === 1 ? 'h3' : 'h4', {}, b.text))
    else if (b.type === 'paragraph') body.push(h('p', {}, renderContent(b.text, v, undefined, [e.pubkey])))
    else if (b.type === 'quote') body.push(h('blockquote', {}, renderContent(b.text, v, undefined, [e.pubkey])))
    else if (b.type === 'code') body.push(h('pre', { class: 'article-code' }, b.text))
    else body.push(h('hr', {}))
  }
  return h('article', { class: 'card article' }, ...head, h('div', { class: 'article-body' }, ...body))
}

/** Notes | Replies on an account's page. */
export function renderProfileMode(mode: 'notes' | 'replies', onChange: (m: 'notes' | 'replies') => void, v: View): HTMLElement {
  return h('div', { class: 'seg feedmode two', role: 'group', 'aria-label': t(v.lang, 'feedModeTitle') }, ...(['notes', 'replies'] as const).map((m) =>
    h('button', { type: 'button', 'aria-pressed': String(mode === m), onClick: () => { if (mode !== m) onChange(m) } }, t(v.lang, m === 'notes' ? 'profileNotes' : 'profileReplies'))))
}

/** Accounts that started following the reader since the last visit: the first few, with a count of the rest. */
export function renderFollowers(keys: string[], v: View): HTMLElement | null {
  if (!keys.length) return null
  const SHOWN = 8
  return h('section', { class: 'followers card' }, h('h2', {}, `${t(v.lang, 'followersTitle')} (${keys.length})`),
    h('ul', {}, ...keys.slice(0, SHOWN).map((k) => h('li', {}, h('a', { class: 'follower-link', href: userHref(k) }, avatarEl(k, v), h('span', {}, nameOf(v, k))))), keys.length > SHOWN ? h('li', { class: 'more-followers' }, t(v.lang, 'followersMore', { n: keys.length - SHOWN })) : null))
}

export interface Person { pubkey: string; tag: string | null }
/** A list of accounts, as text: avatar, name, short key and (if any) how it relates to you. Tandas of PAGE, the names of each one asked for just before it is shown. */
export function renderPeople(people: Person[], v: View, o: { title: string; count: number; note: string; approximate: boolean; nameThem?: (keys: string[]) => Promise<void> }): HTMLElement {
  const ul = h('ul', { class: 'people' })
  const more = h('button', { type: 'button', class: 'more' }, '')
  let shown = 0
  const row = (p: Person) => h('li', {}, h('a', { class: 'person', href: userHref(p.pubkey) }, avatarEl(p.pubkey, v), h('span', { class: 'who' }, h('strong', {}, nameOf(v, p.pubkey)), h('span', { class: 'meta' }, shortNpub(p.pubkey))), p.tag ? h('span', { class: 'tag' }, p.tag) : null))
  const add = async () => {
    const next = people.slice(shown, shown + PAGE)
    more.disabled = true
    try { await o.nameThem?.(next.map((p) => p.pubkey)) } catch { /* names are a nicety */ }
    for (const p of next) ul.append(row(p))
    shown += next.length; more.disabled = false
    if (shown >= people.length) more.remove(); else more.textContent = t(v.lang, 'showMore', { n: people.length - shown })
  }
  more.addEventListener('click', () => void add())
  for (const p of people.slice(0, PAGE)) ul.append(row(p)) // the first tanda's names were loaded by the caller
  shown = Math.min(people.length, PAGE)
  if (shown < people.length) { more.textContent = t(v.lang, 'showMore', { n: people.length - shown }) }
  return h('section', { class: 'people-page card' }, h('h2', {}, `${o.title} (${o.approximate ? '~' : ''}${o.count})`), h('p', { class: 'meta' }, o.note),
    people.length ? ul : h('p', { class: 'empty' }, t(v.lang, 'noPeople')), shown < people.length ? more : null)
}

/** Following can show the people you follow or the wider network; two buttons, the open one is lit. */
export function renderFeedMode(mode: FeedMode, onChange: (m: FeedMode) => void, v: View): HTMLElement {
  // the box measures the room it has (a phone, or a narrow column on a wide screen): four in a row when they fit, two by two when they do not
  return h('div', { class: 'feedmode-box' }, h('div', { class: 'seg feedmode', role: 'group', 'aria-label': t(v.lang, 'feedModeTitle') }, ...(['follows', 'network', 'popular', 'highlights'] as const).map((m) =>
    h('button', { type: 'button', 'aria-pressed': String(mode === m), onClick: () => { if (mode !== m) onChange(m) } }, t(v.lang, `feedMode_${m}` as Parameters<typeof t>[1])))))
}

/** The Help page: sections that fold, built from text only. What is open is kept by the caller, because the page is rebuilt on every redraw. */
export function renderHelp(v: View, open: ReadonlySet<string>, onToggle: (id: string, isOpen: boolean) => void): HTMLElement {
  return h('section', { class: 'help card' }, h('h2', {}, t(v.lang, 'helpTitle')),
    ...HELP[v.lang].map((s) => h('details', { class: 'help-section', 'data-id': s.id, ...(open.has(s.id) ? { open: true } : {}), onToggle: (e: Event) => onToggle(s.id, (e.target as HTMLDetailsElement).open) },
      h('summary', {}, s.title),
      ...helpBlocks(s.body).map((b) => (b.kind === 'p' ? h('p', {}, b.text) : h('ul', {}, ...b.items.map((i) => h('li', {}, i))))))),
    // the one real link in the app: it leaves Quill, so it opens in a new tab and tells the other site nothing about this one
    h('p', { class: 'help-foot' }, t(v.lang, 'helpSource'), ' ', h('a', { href: SOURCE_URL, target: '_blank', rel: 'noopener noreferrer' }, SOURCE_URL.replace('https://', ''))))
}
export const SOURCE_URL = 'https://github.com/rzazo24/quill'

export interface PrefsProps {
  font: FontSize; avatars: AvatarStyle; sampleKey: string; onAvatars: (s: AvatarStyle) => void; realAvatars?: boolean; onRealAvatars?: (on: boolean) => void; reposts: boolean; onReposts: (on: boolean) => void; clientTag?: boolean; onClientTag?: (on: boolean) => void; outbox: boolean; onOutbox: (on: boolean) => void; nwc?: { relay: string | null; state: { testing: true } | { balance: number | null } | { error: string } | null; error: string | null; canSign: boolean }; onNwcSave?: (text: string) => void; onNwcRemove?: () => void; onNwcTest?: () => void; interests: string[]; onInterests: (text: string) => void; autoImages: boolean; onAutoImages: (on: boolean) => void; scheme: Scheme; onScheme: (s: Scheme) => void; halloween: boolean; onHalloween: (on: boolean) => void; relays: string[]; isDefault: boolean; error: string | null; probe: ReadonlyMap<string, 'testing' | 'up' | 'down'>
  /** The list published on Nostr compared with this one, and what can be done about it. */
  list: { state: ListState; publishedCount: number; canSign: boolean; confirming: boolean }
  onAskPublish: () => void; onCancelPublish: () => void; onPublish: () => void; onUsePublished: () => void
  onFont: (f: FontSize) => void; onAdd: (text: string) => void; onRemove: (url: string) => void; onTest: (url: string) => void; onReset: () => void
}
/** Text size and the relay list. */
export function renderPrefs(p: PrefsProps, v: View): HTMLElement {
  const input = h('input', { type: 'text', placeholder: t(v.lang, 'relayPlaceholder'), autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', inputmode: 'url', 'aria-label': t(v.lang, 'relaysTitle') })
  const state = (u: string) => p.probe.get(u)
  return h('section', { class: 'prefs card' },
    h('h2', {}, t(v.lang, 'prefsTitle')),
    h('h3', {}, t(v.lang, 'fontTitle')),
    h('div', { class: 'seg', role: 'group', 'aria-label': t(v.lang, 'fontTitle') }, ...FONT_SIZES.map((f) =>
      h('button', { type: 'button', class: `size-${f}`, 'aria-pressed': String(p.font === f), onClick: () => { if (p.font !== f) p.onFont(f) } }, t(v.lang, `font_${f}` as Parameters<typeof t>[1])))),
    h('h3', {}, t(v.lang, 'schemeTitle')),
    h('div', { class: 'seg scheme', role: 'group', 'aria-label': t(v.lang, 'schemeTitle') }, ...SCHEMES.map((x) =>
      h('button', { type: 'button', 'aria-pressed': String(p.scheme === x), onClick: () => { if (p.scheme !== x) p.onScheme(x) } }, t(v.lang, `scheme_${x}` as Parameters<typeof t>[1])))),
    p.halloween ? h('p', { class: 'meta' }, t(v.lang, 'schemeHalloween')) : null,
    h('h3', {}, t(v.lang, 'avatarsTitle')),
    h('div', { class: 'seg avatars', role: 'group', 'aria-label': t(v.lang, 'avatarsTitle') }, ...AVATAR_STYLES.map((a) =>
      h('button', { type: 'button', class: `avatar-${a}`, 'aria-pressed': String(p.avatars === a), onClick: () => { if (p.avatars !== a) p.onAvatars(a) } }, avatarEl(p.sampleKey, v, 'md', a), t(v.lang, `avatar_${a}` as Parameters<typeof t>[1])))),
    p.onRealAvatars ? h('label', { class: 'check' }, h('span', {}, t(v.lang, 'realAvatars')), h('input', { type: 'checkbox', role: 'switch', ...(p.realAvatars ? { checked: true } : {}), onChange: (e: Event) => p.onRealAvatars!((e.target as HTMLInputElement).checked) })) : null,
    p.onRealAvatars ? h('p', { class: 'meta' }, t(v.lang, 'realAvatarsHelp')) : null,
    h('label', { class: 'check' }, h('span', {}, t(v.lang, 'halloweenTheme')), h('input', { type: 'checkbox', role: 'switch', ...(p.halloween ? { checked: true } : {}), onChange: (e: Event) => p.onHalloween((e.target as HTMLInputElement).checked) })), h('p', { class: 'meta' }, t(v.lang, 'halloweenHelp')),
    h('label', { class: 'check' }, h('span', {}, t(v.lang, 'showReposts')), h('input', { type: 'checkbox', role: 'switch', ...(p.reposts ? { checked: true } : {}), onChange: (e: Event) => p.onReposts((e.target as HTMLInputElement).checked) })),
    h('label', { class: 'check' }, h('span', {}, t(v.lang, 'autoImages')), h('input', { type: 'checkbox', role: 'switch', ...(p.autoImages ? { checked: true } : {}), onChange: (e: Event) => p.onAutoImages((e.target as HTMLInputElement).checked) })), h('p', { class: 'meta' }, t(v.lang, 'autoImagesHelp')),
    h('h3', {}, t(v.lang, 'interestsTitle')), interestsArea(p), h('p', { class: 'meta' }, t(v.lang, 'interestsHelp')),
    p.onClientTag ? h('label', { class: 'check' }, h('span', {}, t(v.lang, 'clientTag')), h('input', { type: 'checkbox', role: 'switch', ...(p.clientTag ? { checked: true } : {}), onChange: (e: Event) => p.onClientTag!((e.target as HTMLInputElement).checked) })) : null,
    p.onClientTag ? h('p', { class: 'meta' }, t(v.lang, 'clientTagHelp')) : null,
    h('h3', {}, t(v.lang, 'relaysTitle')), h('p', { class: 'meta' }, t(v.lang, 'relaysHelp')),
    h('ul', { class: 'relay-list' }, ...p.relays.map((u) => h('li', {},
      h('span', { class: 'url' }, u.replace(/^wss:\/\//, '')),
      state(u) ? h('span', { class: `probe ${state(u)}`, role: 'status' }, t(v.lang, state(u) === 'testing' ? 'relayTesting' : state(u) === 'up' ? 'relayUp' : 'relayDown')) : null,
      h('button', { type: 'button', class: 'link', ...(state(u) === 'testing' ? { disabled: true } : {}), onClick: () => p.onTest(u) }, t(v.lang, 'relayTest')),
      h('button', { type: 'button', class: 'link', ...(p.relays.length <= 1 ? { disabled: true, title: t(v.lang, 'relayLast') } : {}), 'aria-label': `${t(v.lang, 'relayRemove')} ${u}`, onClick: () => p.onRemove(u) }, t(v.lang, 'relayRemove'))))),
    h('form', { class: 'relay-add', onSubmit: (e: Event) => { e.preventDefault(); p.onAdd(input.value) } }, input, ' ', h('button', { type: 'submit' }, t(v.lang, 'relayAdd'))),
    p.error ? h('p', { class: 'error', role: 'alert' }, p.error) : null,
    p.isDefault ? null : h('p', {}, h('button', { type: 'button', class: 'link', onClick: p.onReset }, t(v.lang, 'relayReset'))),
    renderRelayListSync(p, v),
    h('label', { class: 'check' }, h('span', {}, t(v.lang, 'outbox')), h('input', { type: 'checkbox', role: 'switch', ...(p.outbox ? { checked: true } : {}), onChange: (e: Event) => p.onOutbox((e.target as HTMLInputElement).checked) })), h('p', { class: 'meta' }, t(v.lang, 'outboxHelp')),
    p.nwc ? walletArea(p, v) : null)
}

/** The wallet for zaps: the risk is said before anything can be pasted, and again how it is kept once it is. */
function walletArea(p: PrefsProps, v: View): HTMLElement {
  const w = p.nwc!
  const said = !w.state ? null : 'testing' in w.state ? h('p', { class: 'status loading', role: 'status' }, h('span', {}, t(v.lang, 'nwcTesting'))) : 'error' in w.state ? h('p', { class: 'error', role: 'alert' }, t(v.lang, 'nwcFailed', { error: w.state.error })) : h('p', { class: 'meta', role: 'status' }, w.state.balance === null ? t(v.lang, 'nwcAnswered') : t(v.lang, 'nwcBalance', { sats: w.state.balance.toLocaleString(v.lang === 'es' ? 'es-ES' : 'en-GB') }))
  if (w.relay) return h('div', { class: 'wallet' }, h('h3', {}, t(v.lang, 'nwcTitle')),
    h('p', { class: 'meta' }, t(v.lang, 'nwcSaved', { relay: w.relay.replace(/^wss:\/\//, '') })), said,
    w.canSign ? null : h('p', { class: 'meta' }, t(v.lang, 'nwcNeedSigner')),
    h('p', { class: 'buttons' }, h('button', { type: 'button', onClick: () => p.onNwcTest?.() }, t(v.lang, 'nwcTest')), ' ', h('button', { type: 'button', class: 'danger', onClick: () => p.onNwcRemove?.() }, t(v.lang, 'nwcRemove'))),
    h('p', { class: 'meta wallet-risk' }, t(v.lang, 'nwcRisk')))
  const input = h('input', { type: 'password', class: 'nwc-input', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', placeholder: t(v.lang, 'nwcPlaceholder'), 'aria-label': t(v.lang, 'nwcTitle') }) as HTMLInputElement
  return h('div', { class: 'wallet' }, h('h3', {}, t(v.lang, 'nwcTitle')),
    h('p', { class: 'meta' }, t(v.lang, 'nwcHelp')),
    h('p', { class: 'warning wallet-risk', role: 'note' }, t(v.lang, 'nwcRisk')),
    h('form', { class: 'nwc-form', onSubmit: (e: Event) => { e.preventDefault(); p.onNwcSave?.(input.value) } }, input, h('button', { type: 'submit' }, t(v.lang, 'nwcSave'))),
    w.error ? h('p', { class: 'error', role: 'alert' }, w.error) : null)
}

function interestsArea(p: PrefsProps): HTMLElement {
  const area = h('textarea', { class: 'interests', rows: '3', autocapitalize: 'none', spellcheck: 'false', onChange: (e: Event) => p.onInterests((e.target as HTMLTextAreaElement).value) }) as HTMLTextAreaElement
  area.value = p.interests.join('\n')
  return area
}

/** Is the list the same on Nostr? Publishing it is a public act, so it asks first. */
function renderRelayListSync(p: PrefsProps, v: View): HTMLElement | null {
  const { state, publishedCount, canSign, confirming } = p.list
  if (state === 'unknown') return null
  const say = state === 'none' ? t(v.lang, 'listNone') : state === 'same' ? t(v.lang, 'listSame') : t(v.lang, 'listDiffers', { n: publishedCount })
  return h('div', { class: 'list-sync' },
    h('p', { class: 'meta' }, say),
    state === 'same' ? null
      : confirming ? h('div', { class: 'confirm' }, h('p', {}, t(v.lang, 'listConfirm', { n: p.relays.length })), h('p', {}, h('button', { type: 'button', class: 'primary', onClick: p.onPublish }, t(v.lang, 'listSign')), ' ', h('button', { type: 'button', class: 'link', onClick: p.onCancelPublish }, t(v.lang, 'listCancel'))))
      : h('p', {}, ...(canSign ? [h('button', { type: 'button', onClick: p.onAskPublish }, t(v.lang, 'listPublish'))] : [h('span', { class: 'meta' }, t(v.lang, 'listNeedSigner'))]),
          ...(state === 'differs' ? [' ', h('button', { type: 'button', class: 'link', onClick: p.onUsePublished }, t(v.lang, 'listUse'))] : [])))
}

export function renderSettings(p: SettingsPanelProps, v: View): HTMLElement {
  const { settings: s } = p
  const rule = (key: keyof Settings['rules'], label: Parameters<typeof t>[1]) =>
    h('label', { class: 'check' }, h('span', {}, t(v.lang, label)), h('input', { type: 'checkbox', role: 'switch', ...(s.rules[key] ? { checked: true } : {}), onChange: (e: Event) => p.onSettings({ ...s, rules: { ...s.rules, [key]: (e.target as HTMLInputElement).checked } }) }))
  const select = h('select', { onChange: (e: Event) => p.onSettings({ ...s, maxDistance: Number((e.target as HTMLSelectElement).value) }) },
    h('option', { value: '1', ...(s.maxDistance === 1 ? { selected: true } : {}) }, t(v.lang, 'distance1')),
    h('option', { value: '2', ...(s.maxDistance === 2 ? { selected: true } : {}) }, t(v.lang, 'distance2')),
  )
  const area = h('textarea', { rows: '3', onChange: (e: Event) => p.onWords((e.target as HTMLTextAreaElement).value) })
  area.value = p.words.join('\n')
  return h('section', { class: 'settings' },
    h('h2', {}, t(v.lang, 'settingsTitle')), h('p', {}, t(v.lang, 'settingsHelp')), h('p', { class: 'meta' }, t(v.lang, 'switchHelp')),
    rule('repeatedText', 'ruleRepeated'), rule('burst', 'ruleBurst'), rule('linkOnly', 'ruleLinks'), rule('mentionFlood', 'ruleMentions'), rule('notText', 'ruleNotText'), rule('outsideNetwork', 'ruleNetwork'),
    h('label', {}, t(v.lang, 'distance'), ' ', select),
    h('label', {}, t(v.lang, 'mutedWords'), h('br'), area), h('small', {}, t(v.lang, 'mutedWordsHelp')),
    p.graph ? h('p', { class: 'graph' }, p.graph.loaded ? t(v.lang, 'graphInfo', { answered: p.graph.answered, total: p.graph.total }) : t(v.lang, 'graphOff')) : null,
  )
}

/** "Your notes, safe": what is checked, the answer, the copy and the file. Nothing in it signs; copying sends notes already signed. */
type ScannedState = { phase: 'scanned'; total: number; single: number; missing: number; toCopy: number; perRelay: { relay: string; count: number; failed: boolean }[] }
export type RescueState =
  | { phase: 'idle' }
  | { phase: 'scanning'; done: number; of: number }
  | ScannedState
  | { phase: 'copying'; done: number; of: number; /** what the check said, still shown while copying (the card keeps its size) */ from?: ScannedState }
  | { phase: 'copied'; results: { relay: string; ok: number; failed: number; reason?: string }[] }
export interface RescueProps { state: RescueState; saving: boolean | 'failed' | 'done'; savedCount?: number; onScan: () => void; onCopy: () => void; onSave: () => void }

export function renderRescue(p: RescueProps, v: View): HTMLElement {
  const s = p.state, host = (u: string) => u.replace(/^wss:\/\//, '')
  const body: Child[] = []
  if (s.phase === 'idle') body.push(h('p', {}, h('button', { type: 'button', onClick: p.onScan }, t(v.lang, 'rescueScan'))))
  else if (s.phase === 'scanning') body.push(h('p', { class: 'status loading rescue-progress', role: 'status' }, h('span', {}, t(v.lang, 'rescueScanning', { done: s.done, of: s.of }))))
  else if (s.phase === 'scanned' || (s.phase === 'copying' && s.from)) {
    const sc = s.phase === 'scanned' ? s : s.from!
    body.push(h('p', { class: 'rescue-summary' }, h('strong', {}, t(v.lang, sc.total === 1 ? 'rescueTotalOne' : 'rescueTotal', { n: sc.total })), sc.total ? ` · ${t(v.lang, 'rescueSingle', { n: sc.single })} · ${t(v.lang, 'rescueMissing', { n: sc.missing })}` : ''))
    body.push(h('ul', { class: 'rescue-relays' }, ...sc.perRelay.map((r) => h('li', {}, h('span', { class: 'url' }, host(r.relay)), ' ', h('span', { class: r.failed ? 'meta error' : 'meta' }, r.failed ? t(v.lang, 'rescueNoAnswer') : String(r.count))))))
    body.push(s.phase === 'copying' ? h('p', {}, h('button', { type: 'button', class: 'primary rescue-progress', disabled: true, role: 'status' }, h('span', {}, t(v.lang, 'rescueCopying', { done: s.done, of: s.of }))), ' ', h('button', { type: 'button', class: 'link', disabled: true }, t(v.lang, 'rescueAgain'))) // the same buttons, still: the card keeps its size
      : sc.toCopy ? h('p', {}, h('button', { type: 'button', class: 'primary', onClick: p.onCopy }, t(v.lang, 'rescueCopy', { n: sc.toCopy })), ' ', h('button', { type: 'button', class: 'link', onClick: p.onScan }, t(v.lang, 'rescueAgain')))
      : h('p', {}, h('span', { class: 'meta' }, t(v.lang, sc.total ? 'rescueAllGood' : 'rescueNothing')), ' ', h('button', { type: 'button', class: 'link', onClick: p.onScan }, t(v.lang, 'rescueAgain'))))
  } else if (s.phase === 'copying') body.push(h('p', { class: 'status loading rescue-progress', role: 'status' }, h('span', {}, t(v.lang, 'rescueCopying', { done: s.done, of: s.of }))))
  else {
    body.push(h('ul', { class: 'rescue-relays' }, ...s.results.map((r) => h('li', {}, h('span', { class: 'url' }, host(r.relay)), ' ', h('span', { class: r.failed ? 'meta error' : 'meta' }, r.failed ? t(v.lang, 'rescueCopiedSome', { ok: r.ok, of: r.ok + r.failed, reason: r.reason ?? '' }) : `${r.ok} ✓`)))))
    if (s.results.some((r) => r.failed)) body.push(h('p', { class: 'meta' }, t(v.lang, 'rescueRefused')))
    body.push(h('p', {}, h('button', { type: 'button', class: 'link', onClick: p.onScan }, t(v.lang, 'rescueAgain'))))
  }
  const saving = p.saving === true ? h('p', { class: 'status loading', role: 'status' }, h('span', {}, t(v.lang, 'rescueSaving')))
    : h('p', {}, h('button', { type: 'button', onClick: p.onSave }, icon('download', 16), t(v.lang, 'rescueSave')), p.saving === 'failed' ? h('span', { class: 'error' }, ' ', t(v.lang, 'rescueSaveFailed')) : p.saving === 'done' ? h('span', { class: 'meta' }, ' ', t(v.lang, 'rescueSaved', { n: p.savedCount ?? 0 })) : null)
  return h('section', { class: 'card rescue' }, h('h2', {}, t(v.lang, 'rescueTitle')), h('p', { class: 'meta' }, t(v.lang, 'rescueHelp')), ...body,
    h('h3', {}, t(v.lang, 'rescueFileTitle')), h('p', { class: 'meta' }, t(v.lang, 'rescueFileHelp')), saving)
}
