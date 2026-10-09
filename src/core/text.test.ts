import { describe, expect, it } from 'vitest'
import { burstOf, cleanText, hasLink, isDistinctive, normalizeText, segments } from './text.js'

describe('cleanText', () => {
  it('removes hidden and reordering characters but keeps emoji sequences', () => {
    expect(cleanText('a​b‮c⁦d﻿e\u0007', 100)).toBe('abcde')
    expect(cleanText('👨‍👩‍👧 ❤️', 100)).toBe('👨‍👩‍👧 ❤️') // ZWJ and the variation selector stay
    expect(cleanText('x\u{E0041}y', 100)).toBe('xy') // Unicode tag characters
  })
  it('tidies line breaks and bounds the length by characters, not bytes', () => {
    expect(cleanText('a\r\n\r\n\r\n\r\nb', 100)).toBe('a\n\nb')
    expect(cleanText('😀😀😀😀', 2)).toBe('😀😀… [+2 chars]')
    expect(cleanText(undefined, 10)).toBe('')
  })
})

describe('segments', () => {
  it('splits text and links, showing the whole address', () => {
    expect(segments('see https://example.com/a?b=1 now')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'link', value: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { type: 'text', value: ' now' },
    ])
  })
  it('leaves final punctuation outside the link', () => {
    const s = segments('(https://example.com/x).')
    expect(s.find((x) => x.type === 'link')?.value).toBe('https://example.com/x')
    expect(s.at(-1)).toEqual({ type: 'text', value: ').' })
  })
  it('only http(s) is a link: javascript:, data: and bare domains stay text', () => {
    for (const t of ['javascript:alert(1)', 'data:text/html,hi', 'example.com/x', 'ftp://example.com']) expect(segments(t)).toEqual([{ type: 'text', value: t }])
    expect(hasLink('no links here')).toBe(false)
    expect(hasLink('look http://a.example')).toBe(true)
  })
  it('never invents markup: angle brackets and quotes are just characters', () => {
    expect(segments('<img src=x onerror=alert(1)> https://e.example/"x')).toEqual([
      { type: 'text', value: '<img src=x onerror=alert(1)> ' },
      { type: 'link', value: 'https://e.example/', href: 'https://e.example/' },
      { type: 'text', value: '"x' },
    ])
  })
})

describe('normalizeText and isDistinctive', () => {
  it('collapses numbers, links, punctuation, emoji and case', () => {
    expect(normalizeText('Buy NOW 50% off!!! 🔥 https://x.example/a')).toBe(normalizeText('buy now 70 off 🚀 https://y.example/b'))
  })
  it('a greeting is not distinctive; three words or a link is', () => {
    expect(isDistinctive(normalizeText('gm'))).toBe(false)
    expect(isDistinctive(normalizeText('good morning'))).toBe(false)
    expect(isDistinctive(normalizeText('good morning nostr'))).toBe(true)
    expect(isDistinctive(normalizeText('https://x.example'))).toBe(true)
  })
})

describe('burstOf', () => {
  it('finds the busiest window', () => {
    expect(burstOf([0, 10, 20, 30, 40, 1000], 60)).toEqual({ events: 5, seconds: 40 })
    expect(burstOf([], 60)).toEqual({ events: 0, seconds: 0 })
  })
})
