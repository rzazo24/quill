// @vitest-environment happy-dom
import { nip19 } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import { ev, pk } from '../core/testutil.js'
import type { Judged } from '../core/verdict.js'
import type { ThreadNode } from '../data/feed.js'
import { renderContent, renderJudged, renderList, renderSummary, renderTree } from './render.js'

const v = { lang: 'en' as const, names: new Map([[pk('a'), 'Ana']]), nowMs: 1_700_001_000_000 }
const shown = (e = ev(pk('a'), 'hello')): Judged => ({ event: e, verdict: { hidden: false, rule: 'default', params: {} } })
const hid = (e = ev(pk('b'), 'buy now')): Judged => ({ event: e, verdict: { hidden: true, rule: 'outside-network', params: { max: 2, hops: 'none' } } })

describe('hostile content stays text', () => {
  const evil = '<img src=x onerror=alert(1)><script>alert(2)</script><a href="javascript:alert(3)">x</a> https://ok.example/path "><svg onload=alert(4)>'
  it('creates no element from a note\'s text', () => {
    const el = renderJudged(shown(ev(pk('a'), evil)), v)
    expect(el.querySelectorAll('img, script, svg, iframe, style, object, embed').length).toBe(0)
    expect(el.querySelector('.body')!.textContent).toContain('<img src=x onerror=alert(1)>')
    const links = [...el.querySelectorAll('a.ext')]
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://ok.example/path'])
    expect(links[0]!.getAttribute('rel')).toBe('noopener noreferrer nofollow')
    expect(el.querySelector('[onerror], [onload]')).toBeNull()
  })
  it('a hostile display name is only text, too', () => {
    const el = renderJudged(shown(ev(pk('c'), 'hi')), { ...v, names: new Map([[pk('c'), '<b onmouseover=alert(1)>x</b>']]) })
    expect(el.querySelector('b')).toBeNull()
    expect(el.querySelector('header strong')!.textContent).toBe('<b onmouseover=alert(1)>x</b>')
  })
  it('hidden characters are removed before display', () => {
    expect(renderContent('a‮b​c', v).textContent).toBe('abc')
  })
  it('never loads anything: no src, srcset, poster or external stylesheet anywhere', () => {
    const el = renderList([shown(ev(pk('a'), 'see https://x.example/a.png and ![img](https://x.example/b.jpg)')), hid()], v)
    expect(el.querySelectorAll('[src], [srcset], [poster], link').length).toBe(0)
  })
})

describe('references', () => {
  it('a person becomes @name (or a short npub) and a note becomes a thread link', () => {
    const el = document.createElement('div')
    el.append(renderContent(`hi nostr:${nip19.npubEncode(pk('a'))} and nostr:${nip19.npubEncode(pk('d'))} see nostr:${nip19.noteEncode('e'.repeat(64))}`, v))
    const refs = [...el.querySelectorAll('a.ref')].map((a) => [a.textContent, a.getAttribute('href')])
    expect(refs[0]).toEqual(['@Ana', '#/mentions'])
    expect(refs[1]![0]).toMatch(/^@npub1/)
    expect(refs[2]).toEqual(['↪ Thread', '#/note/' + 'e'.repeat(64)])
  })
})

describe('folding', () => {
  it('a hidden note is a closed <details> with the reason in its summary and the whole note inside', () => {
    const el = renderJudged(hid(), v)
    expect(el.tagName).toBe('DETAILS')
    expect(el.hasAttribute('open')).toBe(false)
    expect(el.querySelector('summary')!.textContent).toMatch(/Hidden: No path from you to this account within 2 hops/)
    expect(el.querySelector('.body')!.textContent).toBe('buy now') // nothing lost
  })
  it('a shown note is a plain article', () => { expect(renderJudged(shown(), v).tagName).toBe('ARTICLE') })
  it('replies nest by depth, capped, and keep their folds', () => {
    const leaf: ThreadNode = { item: hid(), children: [] }
    let node: ThreadNode = { item: shown(), children: [leaf] }
    for (let i = 0; i < 10; i++) node = { item: shown(), children: [node] }
    const els = renderTree([node], v)
    const depths = [...els[0]!.querySelectorAll('.reply')].map((e) => Number(e.getAttribute('data-depth')))
    expect(Math.max(...depths)).toBe(6)
    expect(els[0]!.querySelectorAll('details.folded').length).toBe(1)
  })
})

describe('summary', () => {
  it('says what was hidden and by what; says "nothing hidden" when so', () => {
    const s = renderSummary({ shown: 23, hidden: 9, byRule: { 'muted-author': 4, 'outside-network': 5 } }, v, () => {})
    expect(s.textContent).toContain('23 shown · 9 hidden')
    expect(s.textContent).toContain('4 muted accounts, 5 outside your network')
    expect(renderSummary({ shown: 3, hidden: 0, byRule: {} }, v, () => {}).textContent).toContain('Nothing hidden')
  })
})
