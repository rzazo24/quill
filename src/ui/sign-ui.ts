// Everything on screen that has to do with signing: connecting Clave, writing, reviewing what will be signed, progress, and the result per relay.
// Pure of state: give it the state and the handlers, get elements. The text of strangers (a reply's target) only ever goes in as text.
import { nip19 } from 'nostr-tools'
import type { FollowAction } from '../core/follow.js'
import type { Event as NostrEvent } from 'nostr-tools'
import { cleanText } from '../core/text.js'
import { EMOJI_GROUPS } from '../core/emojis.js'
import { quoteReserve } from '../core/compose.js'
import { failedRelays } from '../net/publisher.js'
import type { Published, Step } from '../sign/pipeline.js'
import { MAX_NOTE_CHARS, type Template } from '../sign/policy.js'
import { MAX_ZAP_COMMENT, MAX_ZAP_SATS, ZAP_AMOUNTS } from '../core/zapsend.js'
import { h, menuKeys } from './dom.js'
import { t } from './i18n.js'
import { icon } from './icons.js'
import { avatarEl, nameOf, type View } from './render.js'
import { normReaction, type Mine } from '../data/engaged.js'

export const REACTIONS = ['+', '❤️', '🤙', '😂', '🙏', '🔥', '😮', '😢', '🎉', '💯']
/** Added behind the others while the Halloween theme is on. */
export const HALLOWEEN_REACTIONS = ['🎃', '👻', '🦇', '💀', '🕷️']

export interface Composer { mode: 'note' | 'reply' | 'quote'; target?: NostrEvent; text: string; /** the text came back from a saved draft */ restored?: boolean }
export interface Review { template: Template; target?: NostrEvent; mentions: number; quote?: boolean }
/** The panel of a follow / unfollow: reading the list, the confirmation, or why Quill will not go on. */
export type FollowPanel =
  | { stage: 'checking'; action: FollowAction }
  | { stage: 'confirm'; who: string; action: FollowAction; before: number; after: number; changed: boolean }
  | { stage: 'refuse'; action: FollowAction; why: 'none' | 'shrunk'; known: number; found: number }

export interface Flash { kind: 'error' | 'info'; text: string }

export interface SignUiState {
  signer: 'disconnected' | 'connecting' | 'connected'
  who: string | null
  connect: { uri: string; claveLink: string } | null
  connectOpen: boolean
  flash: Flash | null
  composer: Composer | null
  /** A wide screen has no emoji keyboard: the composer offers a small picker. */
  emojiPicker?: boolean
  review: Review | null
  step: Step | null
  result: Published | null
  relays: string[]
  /** What the user has typed in the bunker:// field and whether "use a link instead" is open: kept in the app because the page is redrawn often. */
  bunkerText: string
  linkOpen: boolean
  followPanel: FollowPanel | null
  /** The note the reader is about to share: sharing is public, so it asks first. */
  shareConfirm: NostrEvent | null
  /** A zap being chosen, paid or that failed (paid by the reader's wallet through NWC). */
  zapFlow?: { target: NostrEvent; sats: number; comment: string; stage: 'choose' | 'working' | 'failed'; step?: 'address' | 'signing' | 'invoice' | 'paying'; error?: string } | null
  /** One of the reader's notes about to be deleted: it asks first. */
  deleteConfirm?: NostrEvent | null
  /** Disconnecting asks first: connecting again means pasting the bunker:// address again. */
  confirmDisconnect: boolean
}

export interface SignUiHandlers {
  openConnect(): void; cancelConnect(): void; bunker(text: string): void; dismissFlash(): void; confirmFollow(): void; acceptList(): void; cancelFollow(): void; confirmShare(): void; confirmDelete(): void; cancelDelete(): void; startQuote(): void; cancelShare(): void; askDisconnect(): void; cancelDisconnect(): void; disconnect(): void; copy(text: string): void
  edit(text: string): void; discardDraft(): void; review(): void; publish(): void; back(): void; cancelComposer(): void; retry(): void; dismissResult(): void
  startNote(): void; cancelSigning(): void; startLink(): void; pasteBunker(): void; editBunker(text: string): void; setLinkOpen(open: boolean): void
  zapPick?(sats: number): void; zapCustom?(sats: number): void; zapComment?(text: string): void; confirmZap?(): void; cancelZap?(): void
}

const excerpt = (e: NostrEvent) => cleanText(e.content, 140).replace(/\s+/g, ' ')

/** `where`: on the Me page (and the login screen) the connection itself is shown; on the reading pages only what is needed to write, or a hint to connect. */
export function renderSignArea(s: SignUiState, hd: SignUiHandlers, v: View, signerConfigured: boolean, where: 'me' | 'feed' = 'me', fab = false): HTMLElement | null {
  if (!signerConfigured) return null
  const parts: (HTMLElement | null)[] = []
  const toast: (HTMLElement | null)[] = []
  // a plain notice is a small popup that fades by itself; an error stays in the bar until something else happens
  if (s.flash?.kind === 'error') toast.push(h('p', { class: 'error', role: 'alert' }, s.flash.text, ' ', h('button', { type: 'button', class: 'link', onClick: hd.dismissFlash }, t(v.lang, 'dismiss'))))
  else if (s.flash) parts.push(h('div', { class: 'popup', role: 'status' }, h('span', {}, s.flash.text)))
  if (where === 'feed' && s.signer !== 'connected') parts.push(h('p', { class: 'hint' }, h('a', { href: '#/me' }, t(v.lang, 'connectToWrite'))))
  if (where === 'me' && s.signer === 'disconnected' && !s.connectOpen) parts.push(h('p', {}, h('button', { type: 'button', onClick: hd.openConnect }, t(v.lang, 'connectSigner'))))
  if (where === 'me' && s.connectOpen && s.signer !== 'connected') parts.push(renderConnect(s, hd, v))
  if (where === 'me' && s.signer === 'connected') parts.push(h('div', { class: 'signing-as' },
    h('span', { class: 'dot', 'aria-hidden': 'true' }),
    h('div', { class: 'who' }, h('strong', {}, t(v.lang, 'signerConnected')), h('span', {}, t(v.lang, 'signingAs', { who: s.who ?? '' }))),
    s.confirmDisconnect ? null : h('button', { type: 'button', class: 'danger', onClick: hd.askDisconnect }, t(v.lang, 'disconnectSigner'))))
  if (where === 'me' && s.signer === 'connected' && s.confirmDisconnect) parts.push(h('div', { class: 'confirm-disconnect', role: 'alertdialog', 'aria-label': t(v.lang, 'disconnectSigner') },
    h('p', {}, t(v.lang, 'confirmDisconnect')),
    h('p', { class: 'buttons' }, h('button', { type: 'button', class: 'danger', onClick: hd.disconnect }, t(v.lang, 'disconnectSigner')), ' ', h('button', { type: 'button', onClick: hd.cancelDisconnect }, t(v.lang, 'cancel')))))
  if (s.signer === 'connected') {
    // while the signer works: a popup that stays as long as the wait lasts (it does not fade) and goes away when it is over
    if (s.step) parts.push(h('div', { class: 'popup stay', role: 'status' }, h('span', {}, t(v.lang, `step_${s.step}` as Parameters<typeof t>[1])), s.step === 'waiting' ? h('button', { type: 'button', class: 'link', onClick: hd.cancelSigning }, t(v.lang, 'cancel')) : null))
    else if (s.result) toast.push(renderResult(s.result, s.relays, hd, v))
    else if (s.followPanel) parts.push(sheet(renderFollowPanel(s.followPanel, hd, v)))
    else if (s.zapFlow) parts.push(sheet(renderZap(s.zapFlow, hd, v)))
    else if (s.deleteConfirm) parts.push(sheet(renderDeleteConfirm(s.deleteConfirm, hd, v)))
    else if (s.shareConfirm) parts.push(sheet(renderShareConfirm(s.shareConfirm, hd, v)))
    else if (s.review) parts.push(sheet(renderReview(s, hd, v)))
    else if (s.composer) parts.push(sheet(renderComposer(s, hd, v)))
    else if (fab) parts.push(h('button', { type: 'button', class: 'fab', 'aria-label': t(v.lang, 'newNote').replace(/…$/, ''), title: t(v.lang, 'newNote').replace(/…$/, ''), onClick: hd.startNote }, icon('feather', 28)))
  }
  // what is happening shows at the bottom of the screen, where it is seen wherever the reader has scrolled to
  if (toast.some(Boolean)) parts.push(h('div', { class: 'toast' }, ...toast))
  const onlyHint = where === 'feed' && s.signer !== 'connected' && parts.length === 1 // a lone "connect Clave" button needs no card around it
  // when everything in it floats over the page (the write button, a popup, the panel, the bar), the card around it would be an empty box: it is left out of the layout
  const onlyFloating = parts.every((x) => !x || FLOATING.some((c) => x.classList.contains(c)))
  return parts.some(Boolean) ? h('section', { class: onlyHint ? 'sign hint-only' : onlyFloating ? 'sign bare' : 'sign' }, ...parts) : null
}

function renderConnect(s: SignUiState, hd: SignUiHandlers, v: View): HTMLElement {
  const input = h('input', { type: 'text', placeholder: 'bunker://…', autocomplete: 'off', spellcheck: 'false', 'aria-label': t(v.lang, 'bunkerTitle'), onInput: (e: Event) => hd.editBunker((e.target as HTMLInputElement).value) })
  input.value = s.bunkerText
  return h('div', { class: 'connect' },
    h('h2', {}, t(v.lang, 'connectTitle')), h('p', {}, t(v.lang, 'connectHelp')),
    // The way Clave documents for signing from the background: a bunker:// address copied in Clave.
    h('div', { class: 'bunker' },
      h('h3', {}, t(v.lang, 'bunkerTitle')), h('p', { class: 'meta' }, t(v.lang, 'bunkerHelp')),
      h('form', { onSubmit: (e: Event) => { e.preventDefault(); hd.bunker(input.value) } }, input, ' ', h('button', { type: 'submit' }, t(v.lang, 'bunkerButton'))),
      h('p', {}, h('button', { type: 'button', onClick: hd.pasteBunker }, t(v.lang, 'pasteAndConnect'))),
      s.signer === 'connecting' && !s.connect ? h('p', { class: 'status', role: 'status' }, t(v.lang, 'connectingBunker')) : null),
    // The link / QR way: works, but Clave has to be on screen to answer.
    h('details', { class: 'by-link', ...(s.connect || s.linkOpen ? { open: true } : {}), onToggle: (e: Event) => hd.setLinkOpen((e.target as HTMLDetailsElement).open) },
      h('summary', {}, t(v.lang, 'useLinkInstead')),
      h('p', { class: 'meta' }, t(v.lang, 'linkHelp')),
      s.connect ? h('p', {}, h('a', { class: 'button', href: s.connect.claveLink, rel: 'noopener noreferrer', target: '_blank' }, t(v.lang, 'openClave')), ' ',
        h('button', { type: 'button', class: 'link', onClick: () => hd.copy(s.connect!.uri) }, t(v.lang, 'copyLink'))) : h('p', {}, h('button', { type: 'button', onClick: hd.startLink }, t(v.lang, 'connectSigner'))),
      s.signer === 'connecting' && s.connect ? h('p', { class: 'status', role: 'status' }, t(v.lang, 'connectWaiting')) : null),
    h('p', {}, h('button', { type: 'button', class: 'link', onClick: hd.cancelConnect }, t(v.lang, 'cancel'))),
  )
}

const FLOATING = ['fab', 'popup', 'sheet', 'toast']

/** Writing happens on top of the page, not in the middle of it: a panel at the top of the screen over a dimmed background, so the keyboard never covers it and the feed keeps its place. */
const sheet = (inner: HTMLElement): HTMLElement => h('div', { class: 'sheet' }, inner)

function renderComposer(s: SignUiState, hd: SignUiHandlers, v: View): HTMLElement {
  const c = s.composer
  if (!c) return h('div', {})
  // a quote carries the reference to the note after the comment: what it takes is not left to the comment
  const max = c.mode === 'quote' && c.target ? MAX_NOTE_CHARS - quoteReserve(c.target, s.relays[0] ?? '') : MAX_NOTE_CHARS
  const area = h('textarea', { 'data-keep-focus': 'composer', rows: '4', placeholder: t(v.lang, c.mode === 'quote' ? 'quotePlaceholder' : 'newNote'), 'aria-label': t(v.lang, c.mode === 'reply' ? 'reply' : c.mode === 'quote' ? 'quoteButton' : 'newNote'), onInput: (e: Event) => { hd.edit((e.target as HTMLTextAreaElement).value); count.textContent = t(v.lang, 'chars', { n: [...(e.target as HTMLTextAreaElement).value].length, max }) } })
  area.value = c.text
  const count = h('small', {}, t(v.lang, 'chars', { n: [...c.text].length, max }))
  // "@ana": the accounts whose name starts like that (people you follow first) are offered under the box; a tap puts the standard reference (nostr:npub…)
  // in place of "@ana", which every app shows as a mention and which notifies that person
  const suggest = v.suggestPeople ? h('div', { class: 'mention-suggest', role: 'listbox', 'aria-label': t(v.lang, 'mentionSuggest'), hidden: true }) : null
  const typed = (): { at: number; word: string } | null => {
    const caret = area.selectionStart ?? area.value.length
    const m = /(^|\s)@([\p{L}\p{N}_.-]{1,30})$/u.exec(area.value.slice(0, caret))
    return m ? { at: caret - m[2]!.length - 1, word: m[2]! } : null
  }
  const offer = () => {
    if (!suggest || !v.suggestPeople) return
    const tk = typed(), people = tk ? v.suggestPeople(tk.word) : []
    suggest.hidden = !people.length
    suggest.replaceChildren(...people.map((p) => h('button', { type: 'button', role: 'option', onClick: () => {
      const now = typed(); if (!now) return
      const caret = area.selectionStart ?? area.value.length, ref = `nostr:${nip19.npubEncode(p.pubkey)} `
      area.value = area.value.slice(0, now.at) + ref + area.value.slice(caret)
      area.selectionStart = area.selectionEnd = now.at + ref.length
      area.dispatchEvent(new Event('input')); area.focus(); suggest.hidden = true
    } }, avatarEl(p.pubkey, v), h('span', { class: 'mention-name' }, p.name), p.relation === 'none' ? null : h('small', { class: 'meta' }, t(v.lang, p.relation === 'follow' ? 'relFollow' : 'relNetwork')))))
  }
  area.addEventListener('input', offer); area.addEventListener('click', offer); area.addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow')) offer() })
  // with a keyboard: arrow down from the box goes into the names, arrows move among them, Escape goes back to the text without choosing
  if (suggest) {
    area.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' && !suggest.hidden) { const first = suggest.querySelector<HTMLElement>('button'); if (first) { e.preventDefault(); first.focus() } } else if (e.key === 'Escape' && !suggest.hidden) { e.preventDefault(); suggest.hidden = true } })
    menuKeys(suggest, () => area, () => { suggest.hidden = true })
  }
  // the emoji picker (wide screens): a button that opens a grid; a tap puts the emoji where the cursor is
  const insert = (emoji: string) => {
    const at = area.selectionStart ?? area.value.length, to = area.selectionEnd ?? at
    area.value = area.value.slice(0, at) + emoji + area.value.slice(to)
    area.selectionStart = area.selectionEnd = at + emoji.length
    area.dispatchEvent(new Event('input')); area.focus()
  }
  const picker = s.emojiPicker ? h('div', { class: 'emoji-panel', role: 'group', 'aria-label': t(v.lang, 'emojis'), hidden: true }, ...EMOJI_GROUPS.flatMap((g) => g).map((e) => h('button', { type: 'button', onClick: () => insert(e) }, e))) : null
  const toggle = picker ? h('button', { type: 'button', class: 'emoji-toggle', 'aria-label': t(v.lang, 'emojis'), title: t(v.lang, 'emojis'), 'aria-expanded': 'false', onClick: () => { picker.hidden = !picker.hidden; toggle!.setAttribute('aria-expanded', String(!picker.hidden)) } }, '🙂') : null
  if (picker && toggle) menuKeys(picker, () => toggle, () => { picker.hidden = true; toggle.setAttribute('aria-expanded', 'false') }, true)
  return h('div', { class: 'composer' },
    (c.mode === 'reply' || c.mode === 'quote') && c.target ? h('p', { class: 'replying' }, t(v.lang, c.mode === 'quote' ? 'quotingTo' : 'replyingTo', { who: nameOf(v, c.target.pubkey) }), ': ', h('q', {}, excerpt(c.target))) : null,
    c.restored ? h('p', { class: 'meta draft-line' }, t(v.lang, 'draftRestored'), ' ', h('button', { type: 'button', class: 'link', onClick: hd.discardDraft }, t(v.lang, 'draftDiscard'))) : null,
    area, suggest, picker, h('p', { class: 'composer-buttons' }, count, ' ', toggle, toggle ? ' ' : null, h('button', { type: 'button', onClick: hd.review }, t(v.lang, 'review')), ' ', h('button', { type: 'button', onClick: hd.cancelComposer }, t(v.lang, 'cancel'))),
  )
}

/** Following or unfollowing replaces the whole public list, so it says exactly what changes, and why it refuses when the list does not look right. */
function renderFollowPanel(f: FollowPanel, hd: SignUiHandlers, v: View): HTMLElement {
  const mute = f.action === 'mute' || f.action === 'unmute', k = (follow: Parameters<typeof t>[1], muteKey: Parameters<typeof t>[1]) => (mute ? muteKey : follow) // the same panel, the mute list's words
  if (f.stage === 'checking') return h('div', { class: 'review', role: 'status' }, h('p', {}, t(v.lang, k('followChecking', 'muteChecking'))), h('p', { class: 'buttons' }, h('button', { type: 'button', class: 'link', onClick: hd.cancelFollow }, t(v.lang, 'cancel'))))
  if (f.stage === 'refuse') return h('div', { class: 'review', role: 'alertdialog', 'aria-label': t(v.lang, k('followRefuseTitle', 'muteRefuseTitle')) },
    h('h2', {}, t(v.lang, k('followRefuseTitle', 'muteRefuseTitle'))), h('p', {}, t(v.lang, f.why === 'none' ? k('followRefuseNone', 'muteRefuseNone') : k('followRefuseShrunk', 'muteRefuseShrunk'), { known: f.known, found: f.found })),
    h('p', { class: 'buttons' }, ...(f.why === 'shrunk' ? [h('button', { type: 'button', onClick: hd.acceptList }, t(v.lang, 'followAccept')), ' '] : []), h('button', { type: 'button', class: 'primary', onClick: hd.cancelFollow }, t(v.lang, 'cancel'))))
  const title = t(v.lang, `${f.action}Title` as 'followTitle', { who: f.who })
  return h('div', { class: 'review', role: 'alertdialog', 'aria-label': title },
    h('h2', {}, title), f.changed ? h('p', { class: 'error' }, t(v.lang, 'followChanged')) : null,
    h('p', {}, t(v.lang, k('followCount', 'muteCount'), { a: f.before, b: f.after })), h('p', { class: 'meta' }, t(v.lang, k('followPublic', 'mutePublic'))),
    h('p', { class: 'buttons' }, h('button', { type: 'button', class: 'primary', onClick: hd.confirmFollow }, t(v.lang, `${f.action}Button` as 'followButton')), ' ', h('button', { type: 'button', class: 'link', onClick: hd.cancelFollow }, t(v.lang, 'cancel'))))
}

/** A note's text for a confirmation: a quoted note's long reference reads as "[quoted note]", a mention as "@name". */
const previewText = (content: string, v: View): string => cleanText(content, 400)
  .replace(/nostr:(nevent1|note1)[a-z0-9]+/g, `[${t(v.lang, 'quotedNote')}]`)
  .replace(/nostr:(npub1|nprofile1)[a-z0-9]+/g, (m) => { try { const d = nip19.decode(m.slice(6)); return '@' + nameOf(v, d.type === 'npub' ? d.data : (d.data as { pubkey: string }).pubkey) } catch { return m } })

/** Deleting one of the reader's notes: the note is shown, what deleting does and does not do is said, and nothing is signed until the second tap. */
function renderDeleteConfirm(target: NostrEvent, hd: SignUiHandlers, v: View): HTMLElement {
  return h('div', { class: 'review', role: 'alertdialog', 'aria-label': t(v.lang, 'deleteTitle') },
    h('h2', {}, t(v.lang, 'deleteTitle')),
    h('pre', { class: 'preview' }, previewText(target.content, v)),
    h('p', { class: 'meta' }, t(v.lang, 'deleteNoteHelp')),
    h('p', { class: 'buttons' }, h('button', { type: 'button', class: 'danger', onClick: hd.confirmDelete }, t(v.lang, 'deleteConfirm')), ' ', h('button', { type: 'button', class: 'link', onClick: hd.cancelDelete }, t(v.lang, 'cancel'))))
}

/** Sharing a note is public and cannot be undone from here: the note is shown, and nothing is signed until the second tap. */
function renderShareConfirm(target: NostrEvent, hd: SignUiHandlers, v: View): HTMLElement {
  return h('div', { class: 'review', role: 'alertdialog', 'aria-label': t(v.lang, 'shareTitle') },
    h('h2', {}, t(v.lang, 'shareTitle')),
    h('p', { class: 'meta' }, t(v.lang, 'shareBy', { who: nameOf(v, target.pubkey) })),
    h('pre', { class: 'preview' }, previewText(target.content, v)),
    h('p', { class: 'meta' }, t(v.lang, 'shareNote')),
    h('p', { class: 'buttons' }, h('button', { type: 'button', class: 'primary', onClick: hd.confirmShare }, t(v.lang, 'shareConfirm')), ' ', h('button', { type: 'button', onClick: hd.startQuote }, t(v.lang, 'quoteButton')), ' ', h('button', { type: 'button', class: 'link', onClick: hd.cancelShare }, t(v.lang, 'cancel'))))
}

/** A zap: the amount (a few at hand, or another), an optional public comment, and one button that says exactly how much. While it is being paid it
 *  only says which step it is on (a payment under way cannot be taken back); if it failed, why, with the chance to try again. */
function renderZap(z: NonNullable<SignUiState['zapFlow']>, hd: SignUiHandlers, v: View): HTMLElement {
  const title = t(v.lang, 'zapTitle', { who: nameOf(v, z.target.pubkey) })
  if (z.stage === 'working') return h('div', { class: 'review zap', role: 'status', 'aria-label': title }, h('h2', {}, icon('zap', 18), ' ', title), h('p', { class: 'status loading' }, h('span', {}, t(v.lang, `zapStep_${z.step ?? 'address'}` as Parameters<typeof t>[1]))))
  const custom = h('input', { type: 'number', inputmode: 'numeric', min: '1', max: String(MAX_ZAP_SATS), step: '1', class: 'zap-custom', 'aria-label': t(v.lang, 'zapCustom'), placeholder: t(v.lang, 'zapCustom'),
    onInput: (e: Event) => { const n = Number((e.target as HTMLInputElement).value); hd.zapCustom?.(n); confirm.textContent = t(v.lang, 'zapConfirm', { sats: Number.isFinite(n) && n > 0 ? n.toLocaleString(v.lang === 'es' ? 'es-ES' : 'en-GB') : '…' }) } }) as HTMLInputElement
  if (!ZAP_AMOUNTS.includes(z.sats as (typeof ZAP_AMOUNTS)[number])) custom.value = String(z.sats)
  const comment = h('input', { type: 'text', class: 'zap-comment', maxlength: String(MAX_ZAP_COMMENT), 'aria-label': t(v.lang, 'zapCommentLabel'), placeholder: t(v.lang, 'zapCommentLabel'), onInput: (e: Event) => hd.zapComment?.((e.target as HTMLInputElement).value) }) as HTMLInputElement
  comment.value = z.comment
  const confirm = h('button', { type: 'button', class: 'primary', onClick: () => hd.confirmZap?.() }, t(v.lang, 'zapConfirm', { sats: z.sats.toLocaleString(v.lang === 'es' ? 'es-ES' : 'en-GB') }))
  return h('div', { class: 'review zap', role: 'alertdialog', 'aria-label': title },
    h('h2', {}, icon('zap', 18), ' ', title),
    h('pre', { class: 'preview' }, excerpt(z.target)),
    h('div', { class: 'seg zap-amounts', role: 'group', 'aria-label': t(v.lang, 'zapAmount') }, ...ZAP_AMOUNTS.map((n) => h('button', { type: 'button', 'aria-pressed': String(z.sats === n), onClick: () => hd.zapPick?.(n) }, n.toLocaleString(v.lang === 'es' ? 'es-ES' : 'en-GB'))), custom),
    comment,
    z.stage === 'failed' && z.error ? h('p', { class: 'error', role: 'alert' }, z.error) : null,
    h('p', { class: 'meta' }, t(v.lang, 'zapNote')),
    h('p', { class: 'buttons' }, confirm, ' ', h('button', { type: 'button', class: 'link', onClick: () => hd.cancelZap?.() }, t(v.lang, 'cancel'))))
}

/** The exact event that will be signed, in words and in full: nothing is signed that is not on this screen. */
function renderReview(s: SignUiState, hd: SignUiHandlers, v: View): HTMLElement {
  const r = s.review!
  const kind = r.template.kind === 7 ? 'reaction' : 'note'
  return h('div', { class: 'review' },
    h('h2', {}, t(v.lang, 'previewTitle', { who: s.who ?? '' })),
    h('pre', { class: 'preview' }, r.template.content),
    r.target ? h('p', { class: 'meta' }, t(v.lang, r.quote ? 'previewQuoteOf' : 'previewReplyTo', { who: nameOf(v, r.target.pubkey) })) : null,
    r.mentions ? h('p', { class: 'meta' }, t(v.lang, 'previewMentions', { n: r.mentions })) : null,
    h('p', { class: 'meta' }, t(v.lang, 'previewRelays', { n: s.relays.length }), ` · kind ${r.template.kind} (${kind}) · ${r.template.tags.length} tags`),
    r.template.tags.some((x) => x[0] === 'client') ? h('p', { class: 'meta' }, t(v.lang, 'previewClient')) : null,
    h('p', { class: 'meta' }, t(v.lang, 'previewPublic')),
    h('p', { class: 'buttons' }, h('button', { type: 'button', onClick: hd.publish }, t(v.lang, 'publish')), ' ', h('button', { type: 'button', class: 'link', onClick: hd.back }, t(v.lang, 'backEdit'))),
  )
}

function renderResult(r: Published, relays: string[], hd: SignUiHandlers, v: View): HTMLElement {
  const failed = failedRelays(r.outcomes)
  const ok = Object.keys(r.outcomes).length - failed.length
  return h('div', { class: 'result', role: 'status' },
    h('p', { class: failed.length === Object.keys(r.outcomes).length ? 'error' : 'status' }, ok ? t(v.lang, 'published', { ok, total: Object.keys(r.outcomes).length }) : t(v.lang, 'publishedNone')),
    h('ul', {}, ...relays.map((url) => h('li', {}, `${r.outcomes[url] === 'ok' ? '✓' : '✗'} ${url.replace(/^wss:\/\//, '')}`, r.outcomes[url] === 'ok' ? null : ` — ${r.outcomes[url] ?? ''}`))),
    h('p', { class: 'buttons' }, failed.length ? h('button', { type: 'button', onClick: hd.retry }, t(v.lang, 'retryFailed')) : null, ' ', h('button', { type: 'button', class: 'link', onClick: hd.dismissResult }, t(v.lang, 'dismiss'))),
  )
}

/** One-tap reactions under a note, only while a signer is connected. What the reader already did to the note is marked: the reactions given (also ones from other
 *  apps, with emoji this bar does not offer) and whether they replied. */
const VISIBLE_REACTIONS = 3
/** The other reactions, folded behind a "+" that opens them in the same row. */
function moreReactions(chips: HTMLElement[], v: View): HTMLElement {
  const box = h('span', { class: 'more-reactions' })
  const toggle = h('button', { type: 'button', class: 'react more-toggle', 'aria-expanded': 'false', 'aria-label': t(v.lang, 'moreReactions'), title: t(v.lang, 'moreReactions'), onClick: () => { const open = box.classList.toggle('open'); toggle.setAttribute('aria-expanded', String(open)) } }, '+')
  const list = h('span', { class: 'more-reactions-list' }, ...chips)
  menuKeys(list, () => toggle, () => { box.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false') }, true)
  box.append(toggle, list)
  return box
}

export function reactionBar(target: NostrEvent, onReact: (emoji: string) => void, onReply: () => void, v: View, mine: Mine = { reactions: new Set(), replied: false, reposted: false }, onShare?: () => void, onZap?: () => void, zapped = false): HTMLElement {
  const base = v.halloween ? [...REACTIONS, ...HALLOWEEN_REACTIONS] : REACTIONS
  const offered = base.map((e) => normReaction(e))
  const extra = [...mine.reactions].filter((c) => !offered.includes(c)) // given from elsewhere, e.g. 🔥: shown too, so the bar tells the truth
  const chip = (content: string, label: string) => {
    const given = mine.reactions.has(normReaction(content))
    return h('button', { type: 'button', class: given ? 'react on' : 'react', 'aria-pressed': String(given), 'aria-label': given ? t(v.lang, 'reactedWith', { emoji: label }) : `${t(v.lang, 'react')} ${label}`, title: given ? t(v.lang, 'reactedWith', { emoji: label }) : t(v.lang, 'react'), onClick: () => onReact(content) }, label)
  }
  // three reactions are always at hand; the rest wait behind a "+" next to them. One you have already given is always shown (lit), so the bar tells the truth
  const all: [string, string][] = [...base.map((e): [string, string] => [e, e === '+' ? '👍' : e]), ...extra.map((c): [string, string] => [c, c])]
  const given = (c: string) => mine.reactions.has(normReaction(c))
  const shown = all.filter(([c], i) => i < VISIBLE_REACTIONS || given(c)), folded = all.filter(([c], i) => i >= VISIBLE_REACTIONS && !given(c))
  return h('div', { class: 'actions' },
    h('button', { type: 'button', class: mine.replied ? 'link on' : 'link', onClick: onReply }, ...(mine.replied ? [icon('check', 14), t(v.lang, 'replied')] : [t(v.lang, 'reply')])),
    // sharing: only for notes that can be (a text note the filter shows); lit when you already shared it
    onShare ? h('button', { type: 'button', class: mine.reposted ? 'react share on' : 'react share', 'aria-pressed': String(mine.reposted), 'aria-label': t(v.lang, mine.reposted ? 'sharedByYou' : 'share'), title: t(v.lang, mine.reposted ? 'sharedByYou' : 'share'), onClick: onShare }, icon('repost', 16)) : null,
    ...shown.map(([c, label]) => chip(c, label)),
    folded.length ? moreReactions(folded.map(([c, label]) => chip(c, label)), v) : null,
    // a zap, paid by the reader's wallet: only when one is connected on this device
    onZap ? h('button', { type: 'button', class: zapped ? 'react zap-btn on' : 'react zap-btn', 'aria-pressed': String(zapped), 'aria-label': t(v.lang, zapped ? 'zappedByYou' : 'zap'), title: t(v.lang, zapped ? 'zappedByYou' : 'zap'), onClick: onZap }, icon('zap', 16)) : null,
  )
}
