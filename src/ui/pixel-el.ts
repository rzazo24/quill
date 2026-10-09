// The pixel figure of an account as a page element (SVG built with the DOM: nothing is loaded).
import { pixelOf, SIZE } from '../core/pixel.js'

const NS = 'http://www.w3.org/2000/svg'

export function pixelEl(key: string, size = '100%'): SVGElement {
  const p = pixelOf(key), cell = 6, off = (64 - SIZE * cell) / 2
  const svg = document.createElementNS(NS, 'svg')
  for (const [k, v] of Object.entries({ viewBox: '0 0 64 64', width: size, height: size, class: 'pixel', 'shape-rendering': 'crispEdges', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(k, v)
  const add = (tag: string, attrs: Record<string, string>) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); svg.append(e) }
  add('circle', { cx: '32', cy: '32', r: '32', fill: p.background })
  p.cells.forEach((row, r) => row.forEach((on, c) => { if (on) add('rect', { x: String(off + c * cell), y: String(off + r * cell), width: String(cell + 0.35), height: String(cell + 0.35), fill: p.fill }) }))
  return svg
}
