// The robot of an account as a page element (SVG built with the DOM, like the other icons: nothing is loaded).
import { robotOf } from '../core/robot.js'

const NS = 'http://www.w3.org/2000/svg'

export function robotEl(key: string, size = '100%'): SVGElement {
  const r = robotOf(key)
  const svg = document.createElementNS(NS, 'svg')
  for (const [k, v] of Object.entries({ viewBox: '0 0 64 64', width: size, height: size, class: 'robot', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(k, v)
  const bg = document.createElementNS(NS, 'circle')
  for (const [k, v] of Object.entries({ cx: '32', cy: '32', r: '32', fill: r.background })) bg.setAttribute(k, v)
  svg.append(bg)
  for (const p of r.parts) { const e = document.createElementNS(NS, p.tag); for (const [k, v] of Object.entries(p.attrs)) e.setAttribute(k, v); svg.append(e) } // the round box around it cuts what sticks out
  return svg
}
