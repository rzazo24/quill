import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../core/verdict.js'
import { MAX_RELAYS } from '../net/relays.js'
import { MAX_NOTE_CHARS, MAX_SIGNATURES_PER_HOUR } from '../sign/policy.js'
import { HELP, helpBlocks } from './help-text.js'

describe('the help text', () => {
  it('has the same sections, in the same order, in both languages, each with a title and a body', () => {
    expect(HELP.es.map((s) => s.id)).toEqual(HELP.en.map((s) => s.id))
    for (const lang of ['en', 'es'] as const) for (const s of HELP[lang]) { expect(s.title.length, `${lang}/${s.id}`).toBeGreaterThan(2); expect(s.body.length, `${lang}/${s.id}`).toBeGreaterThan(40) }
    expect(new Set(HELP.en.map((s) => s.id)).size).toBe(HELP.en.length)
  })
  it('turns text into paragraphs and bullet lists, in order, and nothing is markup', () => {
    expect(helpBlocks('One.\n\n• a\n• b\n\nTwo <b>x</b>.')).toEqual([{ kind: 'p', text: 'One.' }, { kind: 'ul', items: ['a', 'b'] }, { kind: 'p', text: 'Two <b>x</b>.' }])
    expect(helpBlocks('Intro:\n• a\n• b\nafter')).toEqual([{ kind: 'p', text: 'Intro:' }, { kind: 'ul', items: ['a', 'b'] }, { kind: 'p', text: 'after' }])
  })
  it('the numbers it states are the numbers the code uses', () => {
    for (const lang of ['en', 'es'] as const) {
      const all = HELP[lang].map((s) => s.body).join('\n')
      expect(all, lang).toContain(`${MAX_SIGNATURES_PER_HOUR}`); expect(all, lang).toContain(`${MAX_NOTE_CHARS}`); expect(all, lang).toContain(`1 ${lang === 'en' ? 'to' : 'a'} ${MAX_RELAYS}`)
      expect(all, lang).toContain(`${DEFAULT_SETTINGS.burstEvents} ${lang === 'en' ? 'or more notes in one minute' : 'o más notas en un minuto'}`)
      expect(all, lang).toContain('90')
    }
  })
})
