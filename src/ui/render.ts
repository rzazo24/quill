// Turning judged notes into DOM. Pure of state: give it data, get elements. Nothing here loads anything external.
import type { Child } from './dom.js'
import { h } from './dom.js'
import { refs, shortNpub } from '../core/refs.js'
import { avatarOf } from '../core/avatar.js'
import { showReaction, type ReactionGroup } from '../data/activity.js'
import { AVATAR_STYLES, FONT_SIZES, type AvatarStyle, type FeedMode, type FontSize } from './store.js'
import { robotEl } from './robot-el.js'
import { pixelEl } from './pixel-el.js'
import { HELP, helpBlocks } from './help-text.js'
import type { ListState } from '../data/relaylist.js'
import { icon } from './icons.js'
import { cleanText, segments } from '../core/text.js'
import type { Judged, RuleId, Settings } from '../core/verdict.js'
import type { ThreadNode } from '../data/feed.js'
import { ago, reason, t, tallyLabel, type Lang } from './i18n.js'

export interface View { lang: Lang; names: ReadonlyMap<string, string>; nowMs?: number; /** What the round pictures are made of (default: initials). */ avatars?: AvatarStyle; actions?: (j: Judged) => Child[]; /** Notes that arrived after the reader's last visit are marked. */ isNew?: (e: Judged['event']) => boolean }

export const nameOf = (v: View, pubkey: string): string => v.names.get(pubkey) ?? shortNpub(pubkey)

/** The text of a note: plain text, readable references to people and notes, and links shown in full. Never markup. */
/** The way to a thread: "Thread" in a note's header (this note's conversation) and "Quoted note" where the text points at another note, so the two are never confused. */
export function threadChip(href: string, v: View, label: 'thread' | 'quotedNote' = 'thread'): HTMLElement {
  return h('a', { class: 'thread-link', href }, icon('thread', 14), t(v.lang, label))
}

/** `fromId`: the note this text belongs to; a quoted-note chip carries it so the page it opens can show where you came from. */
export function renderContent(raw: string, v: View, fromId?: string): DocumentFragment {
  const frag = document.createDocumentFragment()
  for (const part of refs(cleanText(raw, 4000))) {
    if (part.type === 'person') frag.append(h('a', { class: 'ref', href: '#/mentions' }, '@' + nameOf(v, part.pubkey)))
    else if (part.type === 'note') frag.append(threadChip(`#/note/${part.id}${fromId && fromId !== part.id ? `?from=${fromId}` : ''}`, v, 'quotedNote'))
    else for (const seg of segments(part.value)) {
      frag.append(seg.type === 'link' ? h('a', { class: 'ext', href: seg.href, rel: 'noopener noreferrer nofollow', target: '_blank' }, seg.value) : seg.value)
    }
  }
  return frag
}

/** A round picture: colour and initials, or a robot, or a pixel figure drawn from the key. Nothing is loaded. The colour goes in through the style object (CSSOM),
 *  which the page's CSP allows. */
export function avatarEl(pubkey: string, v: View, size: 'md' | 'lg' = 'md', style: AvatarStyle = v.avatars ?? 'initials'): HTMLElement {
  if (style !== 'initials') return h('span', { class: size === 'lg' ? 'avatar lg art' : 'avatar art', 'aria-hidden': 'true' }, style === 'robots' ? robotEl(pubkey) : pixelEl(pubkey))
  const a = avatarOf(pubkey, v.names.get(pubkey))
  const el = h('span', { class: size === 'lg' ? 'avatar lg' : 'avatar', 'aria-hidden': 'true' }, a.letters)
  el.style.setProperty('--h', String(a.hue))
  return el
}

function card(j: Judged, v: View, extra: Child[] = []): HTMLElement {
  const { event } = j
  return h('article', { class: v.isNew?.(event) ? 'note new' : 'note', 'data-id': event.id, ...(v.isNew?.(event) ? { 'data-new': t(v.lang, 'newMark') } : {}) },
    avatarEl(event.pubkey, v),
    h('div', { class: 'note-main' },
      j.followedBy?.length ? h('p', { class: 'reposted' }, icon('people', 14), j.followedBy.length > 1 ? t(v.lang, 'followedByMany', { who: nameOf(v, j.followedBy[0]!), n: j.followedBy.length - 1 }) : t(v.lang, 'followedByOne', { who: nameOf(v, j.followedBy[0]!) })) : null,
      j.repostedBy?.length ? h('p', { class: 'reposted' }, icon('repost', 14), j.repostedBy.length > 1 ? t(v.lang, 'repostedMany', { who: nameOf(v, j.repostedBy[0]!), n: j.repostedBy.length - 1 }) : t(v.lang, 'repostedOne', { who: nameOf(v, j.repostedBy[0]!) })) : null,
      h('header', {},
        // name and time run together and may wrap onto two lines; the thread button stays at the top right, always
        h('span', { class: 'byline' },
          h('strong', {}, nameOf(v, event.pubkey)), ' ',
          h('time', { datetime: new Date(event.created_at * 1000).toISOString() }, ago(v.lang, event.created_at, v.nowMs))),
        threadChip(`#/note/${event.id}`, v),
      ),
      h('div', { class: 'body' }, renderContent(event.content, v, event.id)),
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
export function renderList(items: Judged[], v: View): HTMLElement {
  const box = h('section', { class: 'list' })
  if (!items.length) { box.append(h('p', { class: 'empty' }, t(v.lang, 'empty'))); return box }
  let shown = 0
  const more = h('button', { type: 'button', class: 'more' }, '')
  const add = () => {
    for (const j of items.slice(shown, shown + PAGE)) box.insertBefore(renderJudged(j, v), more)
    shown = Math.min(items.length, shown + PAGE)
    if (shown >= items.length) more.remove(); else more.textContent = t(v.lang, 'showMore', { n: items.length - shown })
  }
  more.addEventListener('click', add)
  box.append(more); add()
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

/** Accounts that started following the reader since the last visit: the first few, with a count of the rest. */
export function renderFollowers(keys: string[], v: View): HTMLElement | null {
  if (!keys.length) return null
  const SHOWN = 8
  return h('section', { class: 'followers card' }, h('h2', {}, `${t(v.lang, 'followersTitle')} (${keys.length})`),
    h('ul', {}, ...keys.slice(0, SHOWN).map((k) => h('li', {}, avatarEl(k, v), h('span', {}, nameOf(v, k)))), keys.length > SHOWN ? h('li', { class: 'more-followers' }, t(v.lang, 'followersMore', { n: keys.length - SHOWN })) : null))
}

/** Following can show the people you follow or the wider network; two buttons, the open one is lit. */
export function renderFeedMode(mode: FeedMode, onChange: (m: FeedMode) => void, v: View): HTMLElement {
  return h('div', { class: 'seg feedmode', role: 'group', 'aria-label': t(v.lang, 'feedModeTitle') }, ...(['follows', 'network'] as const).map((m) =>
    h('button', { type: 'button', 'aria-pressed': String(mode === m), onClick: () => { if (mode !== m) onChange(m) } }, t(v.lang, `feedMode_${m}` as Parameters<typeof t>[1]))))
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
  font: FontSize; avatars: AvatarStyle; sampleKey: string; onAvatars: (s: AvatarStyle) => void; reposts: boolean; onReposts: (on: boolean) => void; relays: string[]; isDefault: boolean; error: string | null; probe: ReadonlyMap<string, 'testing' | 'up' | 'down'>
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
    h('h3', {}, t(v.lang, 'avatarsTitle')),
    h('div', { class: 'seg avatars', role: 'group', 'aria-label': t(v.lang, 'avatarsTitle') }, ...AVATAR_STYLES.map((a) =>
      h('button', { type: 'button', class: `avatar-${a}`, 'aria-pressed': String(p.avatars === a), onClick: () => { if (p.avatars !== a) p.onAvatars(a) } }, avatarEl(p.sampleKey, v, 'md', a), t(v.lang, `avatar_${a}` as Parameters<typeof t>[1])))),
    h('label', { class: 'check' }, h('span', {}, t(v.lang, 'showReposts')), h('input', { type: 'checkbox', role: 'switch', ...(p.reposts ? { checked: true } : {}), onChange: (e: Event) => p.onReposts((e.target as HTMLInputElement).checked) })),
    h('h3', {}, t(v.lang, 'relaysTitle')), h('p', { class: 'meta' }, t(v.lang, 'relaysHelp')),
    h('ul', { class: 'relay-list' }, ...p.relays.map((u) => h('li', {},
      h('span', { class: 'url' }, u.replace(/^wss:\/\//, '')),
      state(u) ? h('span', { class: `probe ${state(u)}`, role: 'status' }, t(v.lang, state(u) === 'testing' ? 'relayTesting' : state(u) === 'up' ? 'relayUp' : 'relayDown')) : null,
      h('button', { type: 'button', class: 'link', ...(state(u) === 'testing' ? { disabled: true } : {}), onClick: () => p.onTest(u) }, t(v.lang, 'relayTest')),
      h('button', { type: 'button', class: 'link', ...(p.relays.length <= 1 ? { disabled: true, title: t(v.lang, 'relayLast') } : {}), 'aria-label': `${t(v.lang, 'relayRemove')} ${u}`, onClick: () => p.onRemove(u) }, t(v.lang, 'relayRemove'))))),
    h('form', { class: 'relay-add', onSubmit: (e: Event) => { e.preventDefault(); p.onAdd(input.value) } }, input, ' ', h('button', { type: 'submit' }, t(v.lang, 'relayAdd'))),
    p.error ? h('p', { class: 'error', role: 'alert' }, p.error) : null,
    p.isDefault ? null : h('p', {}, h('button', { type: 'button', class: 'link', onClick: p.onReset }, t(v.lang, 'relayReset'))),
    renderRelayListSync(p, v))
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
    rule('repeatedText', 'ruleRepeated'), rule('burst', 'ruleBurst'), rule('linkOnly', 'ruleLinks'), rule('outsideNetwork', 'ruleNetwork'),
    h('label', {}, t(v.lang, 'distance'), ' ', select),
    h('label', {}, t(v.lang, 'mutedWords'), h('br'), area), h('small', {}, t(v.lang, 'mutedWordsHelp')),
    p.graph ? h('p', { class: 'graph' }, p.graph.loaded ? t(v.lang, 'graphInfo', { answered: p.graph.answered, total: p.graph.total }) : t(v.lang, 'graphOff')) : null,
  )
}
