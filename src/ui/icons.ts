// A few small line icons, drawn here so they look the same on every phone (text arrows and symbols are drawn differently by each system's fonts) and
// load nothing. They are DOM elements, not images, so the page's img-src rule does not come into it. All share one style: 24 grid, 2 px round stroke,
// the colour of the text around them.
const NS = 'http://www.w3.org/2000/svg'

const PATHS = {
  /** a speech bubble: a conversation */
  thread: ['M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.2-4.7A8 8 0 1 1 21 12Z'],
  /** a tick: done */
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  /** a chevron pointing left: go back */
  back: ['M15 18l-6-6 6-6'],
  /** two arrows chasing each other */
  refresh: ['M20 11a8 8 0 0 0-14.7-3', 'M4 4v4h4', 'M4 13a8 8 0 0 0 14.7 3', 'M20 20v-4h-4'],
} as const

export type IconName = keyof typeof PATHS

export function icon(name: IconName, size = 16): SVGElement {
  const svg = document.createElementNS(NS, 'svg')
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: String(size), height: String(size), fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'icon' })) svg.setAttribute(k, v)
  for (const d of PATHS[name]) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.append(p) }
  return svg
}
