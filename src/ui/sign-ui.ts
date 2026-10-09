// Everything on screen that has to do with signing: connecting Clave, writing, reviewing what will be signed, progress, and the result per relay.
// Pure of state: give it the state and the handlers, get elements. The text of strangers (a reply's target) only ever goes in as text.
import type { Event as NostrEvent } from 'nostr-tools'
import { cleanText } from '../core/text.js'
import { failedRelays } from '../net/publisher.js'
import type { Published, Step } from '../sign/pipeline.js'
import { MAX_NOTE_CHARS, type Template } from '../sign/policy.js'
import { h } from './dom.js'
import { t } from './i18n.js'
import { nameOf, type View } from './render.js'

export const REACTIONS = ['+', '❤️', '🤙', '😂', '🙏']

export interface Composer { mode: 'note' | 'reply'; target?: NostrEvent; text: string }
export interface Review { template: Template; target?: NostrEvent; mentions: number }
export interface Flash { kind: 'error' | 'info'; text: string }

export interface SignUiState {
  signer: 'disconnected' | 'connecting' | 'connected'
  who: string | null
  connect: { uri: string; claveLink: string } | null
  connectOpen: boolean
  flash: Flash | null
  composer: Composer | null
  review: Review | null
  step: Step | null
  result: Published | null
  relays: string[]
  /** What the user has typed in the bunker:// field and whether "use a link instead" is open: kept in the app because the page is redrawn often. */
  bunkerText: string
  linkOpen: boolean
}

export interface SignUiHandlers {
  openConnect(): void; cancelConnect(): void; bunker(text: string): void; disconnect(): void; copy(text: string): void
  edit(text: string): void; review(): void; publish(): void; back(): void; cancelComposer(): void; retry(): void; dismissResult(): void
  startNote(): void; cancelSigning(): void; startLink(): void; pasteBunker(): void; editBunker(text: string): void; setLinkOpen(open: boolean): void
}

const excerpt = (e: NostrEvent) => cleanText(e.content, 140).replace(/\s+/g, ' ')

/** `where`: on the Me page (and the login screen) the connection itself is shown; on the reading pages only what is needed to write, or a hint to connect. */
export function renderSignArea(s: SignUiState, hd: SignUiHandlers, v: View, signerConfigured: boolean, where: 'me' | 'feed' = 'me'): HTMLElement | null {
  if (!signerConfigured) return null
  const parts: (HTMLElement | null)[] = []
  const toast: (HTMLElement | null)[] = []
  if (s.flash) toast.push(h('p', { class: s.flash.kind === 'error' ? 'error' : 'status', role: s.flash.kind === 'error' ? 'alert' : 'status' }, s.flash.text))
  if (where === 'feed' && s.signer !== 'connected') parts.push(h('p', { class: 'hint' }, h('a', { href: '#/me' }, t(v.lang, 'connectToWrite'))))
  if (where === 'me' && s.signer === 'disconnected' && !s.connectOpen) parts.push(h('p', {}, h('button', { type: 'button', onClick: hd.openConnect }, t(v.lang, 'connectSigner'))))
  if (where === 'me' && s.connectOpen && s.signer !== 'connected') parts.push(renderConnect(s, hd, v))
  if (where === 'me' && s.signer === 'connected') parts.push(h('p', { class: 'signing-as' }, t(v.lang, 'signingAs', { who: s.who ?? '' }), ' ', h('button', { type: 'button', class: 'link', onClick: hd.disconnect }, t(v.lang, 'disconnectSigner'))))
  if (s.signer === 'connected') {
    if (s.step) toast.push(h('p', { class: 'status', role: 'status' }, t(v.lang, `step_${s.step}` as Parameters<typeof t>[1]), s.step === 'waiting' ? h('span', {}, ' ', h('button', { type: 'button', class: 'link', onClick: hd.cancelSigning }, t(v.lang, 'cancel'))) : null))
    else if (s.result) toast.push(renderResult(s.result, s.relays, hd, v))
    else if (s.review) parts.push(renderReview(s, hd, v))
    else parts.push(renderComposer(s, hd, v))
  }
  // what is happening shows at the bottom of the screen, where it is seen wherever the reader has scrolled to
  if (toast.some(Boolean)) parts.push(h('div', { class: 'toast' }, ...toast))
  const onlyHint = where === 'feed' && s.signer !== 'connected' && parts.length === 1 // a lone "connect Clave" button needs no card around it
  return parts.some(Boolean) ? h('section', { class: onlyHint ? 'sign hint-only' : 'sign' }, ...parts) : null
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

function renderComposer(s: SignUiState, hd: SignUiHandlers, v: View): HTMLElement {
  const c = s.composer
  if (!c) return h('button', { type: 'button', class: 'compose-start', onClick: hd.startNote }, t(v.lang, 'newNote'))
  const area = h('textarea', { rows: '4', placeholder: t(v.lang, 'newNote'), 'aria-label': t(v.lang, c.mode === 'reply' ? 'reply' : 'newNote'), onInput: (e: Event) => { hd.edit((e.target as HTMLTextAreaElement).value); count.textContent = t(v.lang, 'chars', { n: [...(e.target as HTMLTextAreaElement).value].length, max: MAX_NOTE_CHARS }) } })
  area.value = c.text
  const count = h('small', {}, t(v.lang, 'chars', { n: [...c.text].length, max: MAX_NOTE_CHARS }))
  return h('div', { class: 'composer' },
    c.mode === 'reply' && c.target ? h('p', { class: 'replying' }, t(v.lang, 'replyingTo', { who: nameOf(v, c.target.pubkey) }), ': ', h('q', {}, excerpt(c.target))) : null,
    area, h('p', {}, count, ' ', h('button', { type: 'button', onClick: hd.review }, t(v.lang, 'review')), ' ', h('button', { type: 'button', class: 'link', onClick: hd.cancelComposer }, t(v.lang, 'cancel'))),
  )
}

/** The exact event that will be signed, in words and in full: nothing is signed that is not on this screen. */
function renderReview(s: SignUiState, hd: SignUiHandlers, v: View): HTMLElement {
  const r = s.review!
  const kind = r.template.kind === 7 ? 'reaction' : 'note'
  return h('div', { class: 'review' },
    h('h2', {}, t(v.lang, 'previewTitle', { who: s.who ?? '' })),
    h('pre', { class: 'preview' }, r.template.content),
    r.target ? h('p', { class: 'meta' }, t(v.lang, 'previewReplyTo', { who: nameOf(v, r.target.pubkey) })) : null,
    r.mentions ? h('p', { class: 'meta' }, t(v.lang, 'previewMentions', { n: r.mentions })) : null,
    h('p', { class: 'meta' }, t(v.lang, 'previewRelays', { n: s.relays.length }), ` · kind ${r.template.kind} (${kind}) · ${r.template.tags.length} tags`),
    h('p', { class: 'meta' }, t(v.lang, 'previewPublic')),
    h('p', {}, h('button', { type: 'button', onClick: hd.publish }, t(v.lang, 'publish')), ' ', h('button', { type: 'button', class: 'link', onClick: hd.back }, t(v.lang, 'backEdit'))),
  )
}

function renderResult(r: Published, relays: string[], hd: SignUiHandlers, v: View): HTMLElement {
  const failed = failedRelays(r.outcomes)
  const ok = Object.keys(r.outcomes).length - failed.length
  return h('div', { class: 'result', role: 'status' },
    h('p', { class: failed.length === Object.keys(r.outcomes).length ? 'error' : 'status' }, ok ? t(v.lang, 'published', { ok, total: Object.keys(r.outcomes).length }) : t(v.lang, 'publishedNone')),
    h('ul', {}, ...relays.map((url) => h('li', {}, `${r.outcomes[url] === 'ok' ? '✓' : '✗'} ${url.replace(/^wss:\/\//, '')}`, r.outcomes[url] === 'ok' ? null : ` — ${r.outcomes[url] ?? ''}`))),
    h('p', {}, failed.length ? h('button', { type: 'button', onClick: hd.retry }, t(v.lang, 'retryFailed')) : null, ' ', h('button', { type: 'button', class: 'link', onClick: hd.dismissResult }, t(v.lang, 'dismiss'))),
  )
}

/** One-tap reactions under a note, only while a signer is connected. */
export function reactionBar(target: NostrEvent, onReact: (emoji: string) => void, onReply: () => void, v: View): HTMLElement {
  return h('div', { class: 'actions' },
    h('button', { type: 'button', class: 'link', onClick: onReply }, t(v.lang, 'reply')), ' ',
    ...REACTIONS.map((e) => h('button', { type: 'button', class: 'react', 'aria-label': `${t(v.lang, 'react')} ${e}`, title: t(v.lang, 'react'), onClick: () => onReact(e) }, e === '+' ? '👍' : e)),
  )
}
