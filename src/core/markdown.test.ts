import { describe, expect, it } from 'vitest'
import { inline, markdownBlocks } from './markdown.js'

describe('reading an article\'s Markdown as text', () => {
  it('inline marks are dropped; a link keeps its words and its whole address; a picture becomes its address', () => {
    expect(inline('**bold**, _italic_, *also*, `code` and ~~gone~~')).toBe('bold, italic, also, code and gone')
    expect(inline('see [the spec](https://nips.example/23) now')).toBe('see the spec (https://nips.example/23) now')
    expect(inline('[https://a.example](https://a.example)')).toBe('https://a.example')
    expect(inline('![a cat](https://img.example/cat.png)').trim()).toBe('https://img.example/cat.png')
    expect(inline('snake_case_word stays')).toBe('snake_case_word stays')
  })
  it('blocks: headings, paragraphs joined across lines, lists, quotes, code kept as it is, rules', () => {
    const md = '# Title\n\nFirst line\nsame paragraph.\n\n- one\n- two\n\n1. first\n\n> quoted\n> more\n\n```\nlet x = **1**\n```\n\n---\n\nEnd'
    expect(markdownBlocks(md)).toEqual([
      { type: 'heading', level: 1, text: 'Title' }, { type: 'paragraph', text: 'First line same paragraph.' },
      { type: 'item', text: 'one', ordered: false }, { type: 'item', text: 'two', ordered: false }, { type: 'item', text: 'first', ordered: true },
      { type: 'quote', text: 'quoted more' }, { type: 'code', text: 'let x = **1**' }, { type: 'rule' }, { type: 'paragraph', text: 'End' },
    ])
  })
  it('HTML in the text stays text (never markup)', () => {
    expect(markdownBlocks('<script>alert(1)</script>')).toEqual([{ type: 'paragraph', text: '<script>alert(1)</script>' }])
  })
})
