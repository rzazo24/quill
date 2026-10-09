// Turning judged notes into DOM. Pure of state: give it data, get elements. Nothing here loads anything external.
import type { Child } from './dom.js'
import { h } from './dom.js'
import { refs, shortNpub } from '../core/refs.js'
import { cleanText, segments } from '../core/text.js'
import type { Judged, RuleId, Settings } from '../core/verdict.js'
import type { ThreadNode } from '../data/feed.js'
import { ago, reason, t, tallyLabel, type Lang } from './i18n.js'

export interface View { lang: Lang; names: ReadonlyMap<string, string>; nowMs?: number; actions?: (j: Judged) => Child[] }

export const nameOf = (v: View, pubkey: string): string => v.names.get(pubkey) ?? shortNpub(pubkey)

/** The text of a note: plain text, readable references to people and notes, and links shown in full. Never markup. */
export function renderContent(raw: string, v: View): DocumentFragment {
  const frag = document.createDocumentFragment()
  for (const part of refs(cleanText(raw, 4000))) {
    if (part.type === 'person') frag.append(h('a', { class: 'ref', href: '#/mentions' }, '@' + nameOf(v, part.pubkey)))
    else if (part.type === 'note') frag.append(h('a', { class: 'ref', href: `#/note/${part.id}` }, '↪ ' + t(v.lang, 'thread')))
    else for (const seg of segments(part.value)) {
      frag.append(seg.type === 'link' ? h('a', { class: 'ext', href: seg.href, rel: 'noopener noreferrer nofollow', target: '_blank' }, seg.value) : seg.value)
    }
  }
  return frag
}

function card(j: Judged, v: View, extra: Child[] = []): HTMLElement {
  const { event } = j
  return h('article', { class: 'note', 'data-id': event.id },
    h('header', {},
      h('strong', {}, nameOf(v, event.pubkey)), ' ',
      h('time', { datetime: new Date(event.created_at * 1000).toISOString() }, ago(v.lang, event.created_at, v.nowMs)), ' ',
      h('a', { class: 'thread-link', href: `#/note/${event.id}` }, t(v.lang, 'thread')),
    ),
    h('div', { class: 'body' }, renderContent(event.content, v)),
    ...extra, ...(v.actions?.(j) ?? []),
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

export function renderList(items: Judged[], v: View): HTMLElement {
  return h('section', { class: 'list' }, ...(items.length ? items.map((j) => renderJudged(j, v)) : [h('p', { class: 'empty' }, t(v.lang, 'empty'))]))
}

export function renderTree(nodes: ThreadNode[], v: View, depth = 0): HTMLElement[] {
  return nodes.map((n) => h('div', { class: 'reply', 'data-depth': String(Math.min(depth, 6)) }, renderJudged(n.item, v), ...renderTree(n.children, v, depth + 1)))
}

/** "23 shown · 9 hidden" and what hid them, as the line above every list. */
export function renderSummary(tally: { shown: number; hidden: number; byRule: Partial<Record<RuleId, number>> }, v: View, onSettings: () => void): HTMLElement {
  const parts = Object.entries(tally.byRule).map(([rule, n]) => `${n} ${tallyLabel(v.lang, rule as RuleId)}`)
  return h('div', { class: 'summary', role: 'status' },
    h('span', {}, tally.hidden ? t(v.lang, 'hiddenSummary', { shown: tally.shown, hidden: tally.hidden }) : t(v.lang, 'hiddenNothing')),
    parts.length ? h('span', { class: 'parts' }, ` — ${parts.join(', ')}`) : null, ' ',
    h('button', { type: 'button', class: 'link', onClick: onSettings }, t(v.lang, 'filterSettings')),
  )
}

export interface SettingsPanelProps {
  settings: Settings
  words: string[]
  graph: { answered: number; total: number; loaded: boolean } | null
  onSettings: (s: Settings) => void
  onWords: (words: string) => void
}

export function renderSettings(p: SettingsPanelProps, v: View): HTMLElement {
  const { settings: s } = p
  const rule = (key: keyof Settings['rules'], label: Parameters<typeof t>[1]) =>
    h('label', { class: 'check' }, h('input', { type: 'checkbox', ...(s.rules[key] ? { checked: true } : {}), onChange: (e: Event) => p.onSettings({ ...s, rules: { ...s.rules, [key]: (e.target as HTMLInputElement).checked } }) }), ' ', t(v.lang, label))
  const select = h('select', { onChange: (e: Event) => p.onSettings({ ...s, maxDistance: Number((e.target as HTMLSelectElement).value) }) },
    h('option', { value: '1', ...(s.maxDistance === 1 ? { selected: true } : {}) }, t(v.lang, 'distance1')),
    h('option', { value: '2', ...(s.maxDistance === 2 ? { selected: true } : {}) }, t(v.lang, 'distance2')),
  )
  const area = h('textarea', { rows: '3', onChange: (e: Event) => p.onWords((e.target as HTMLTextAreaElement).value) })
  area.value = p.words.join('\n')
  return h('section', { class: 'settings' },
    h('h2', {}, t(v.lang, 'settingsTitle')), h('p', {}, t(v.lang, 'settingsHelp')),
    rule('repeatedText', 'ruleRepeated'), rule('burst', 'ruleBurst'), rule('linkOnly', 'ruleLinks'), rule('outsideNetwork', 'ruleNetwork'),
    h('label', {}, t(v.lang, 'distance'), ' ', select),
    h('label', {}, t(v.lang, 'mutedWords'), h('br'), area), h('small', {}, t(v.lang, 'mutedWordsHelp')),
    p.graph ? h('p', { class: 'graph' }, p.graph.loaded ? t(v.lang, 'graphInfo', { answered: p.graph.answered, total: p.graph.total }) : t(v.lang, 'graphOff')) : null,
  )
}
