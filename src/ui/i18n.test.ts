import { describe, expect, it } from 'vitest'
import type { RuleId } from '../core/verdict.js'
import { ago, detectLang, reason, t, tallyLabel } from './i18n.js'

describe('i18n', () => {
  it('every hideable rule has a sentence and a tally label in both languages, with its params filled in', () => {
    const cases: [RuleId, Record<string, number | string>][] = [
      ['muted-author', {}], ['muted-word', { word: 'giveaway' }], ['repeated-text', { shared: 3, total: 4 }], ['burst', { events: 6, seconds: 40 }],
      ['link-only', { withLink: 4, total: 5 }], ['outside-network', { max: 2, hops: 3 }], ['outside-network', { max: 2, hops: 'none' }],
    ]
    for (const lang of ['en', 'es'] as const) {
      for (const [rule, params] of cases) {
        const s = reason(lang, { hidden: true, rule, params })
        expect(s, `${lang} ${rule}`).not.toMatch(/\{|undefined/)
        expect(s.length).toBeGreaterThan(10)
        expect(tallyLabel(lang, rule)).not.toMatch(/undefined/)
      }
    }
    expect(reason('en', { hidden: true, rule: 'repeated-text', params: { shared: 3, total: 4 } })).toContain('3 of this account')
    expect(reason('es', { hidden: true, rule: 'muted-word', params: { word: 'giveaway' } })).toContain('giveaway')
    expect(reason('en', { hidden: true, rule: 'outside-network', params: { max: 2, hops: 'none' } })).toMatch(/No path/)
  })
  it('both dictionaries have the same keys (the type checks it too)', () => {
    expect(t('en', 'loading')).not.toBe(t('es', 'loading'))
  })
  it('relative time', () => {
    const now = 1_700_000_000_000
    expect(ago('en', now / 1000 - 5, now)).toBe('now')
    expect(ago('en', now / 1000 - 600, now)).toMatch(/10/)
    expect(ago('en', now / 1000 - 3600 * 5, now)).toMatch(/5/)
    expect(ago('en', now / 1000 - 86400 * 90, now)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(ago('en', now / 1000 + 100, now)).toBe('now') // a clock in the future is not a negative age
  })
  it('detects Spanish', () => {
    expect(detectLang(['es-ES', 'en'])).toBe('es'); expect(detectLang(['en-US'])).toBe('en'); expect(detectLang(undefined)).toBe('en')
  })
})
