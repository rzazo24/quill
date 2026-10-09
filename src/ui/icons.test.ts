// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { icon } from './icons.js'

describe('icons', () => {
  it('are small SVG drawings in one shared style, in the colour of the text, hidden from screen readers, with no external references', () => {
    for (const name of ['thread', 'refresh', 'back'] as const) {
      const svg = icon(name, 18)
      expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg'); expect(svg.getAttribute('stroke')).toBe('currentColor'); expect(svg.getAttribute('fill')).toBe('none')
      expect(svg.getAttribute('stroke-width')).toBe('2'); expect(svg.getAttribute('stroke-linecap')).toBe('round'); expect(svg.getAttribute('aria-hidden')).toBe('true')
      expect(svg.getAttribute('width')).toBe('18'); expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
      expect(svg.querySelectorAll('path').length).toBeGreaterThan(0)
      expect(svg.outerHTML).not.toMatch(/href|url\(|<image|<use|<script|<style|on[a-z]+=/i)
    }
  })
})
