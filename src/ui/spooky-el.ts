// The Halloween creature of an account as a page element (SVG built with the DOM, like the robots: nothing is loaded).
import { spookyOf } from '../core/spooky.js'

const NS = 'http://www.w3.org/2000/svg'

export function spookyEl(key: string, size = '100%'): SVGElement {
  const s = spookyOf(key)
  const svg = document.createElementNS(NS, 'svg')
  for (const [k, v] of Object.entries({ viewBox: '0 0 64 64', width: size, height: size, class: 'spooky', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(k, v)
  const bg = document.createElementNS(NS, 'circle')
  for (const [k, v] of Object.entries({ cx: '32', cy: '32', r: '32', fill: s.background })) bg.setAttribute(k, v)
  svg.append(bg)
  for (const p of s.parts) { const e = document.createElementNS(NS, p.tag); for (const [k, v] of Object.entries(p.attrs)) e.setAttribute(k, v); svg.append(e) } // the round box around it cuts what sticks out
  return svg
}
