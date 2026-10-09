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
  /** two people: the accounts you follow */
  people: ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M23 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  /** an @ sign: mentions */
  at: ['M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z', 'M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94'],
  /** one person: you */
  person: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z'],
  /** two arrows going round a rectangle: a repost */
  repost: ['M17 2l3 3-3 3', 'M4 11V9a4 4 0 0 1 4-4h12', 'M7 22l-3-3 3-3', 'M20 13v2a4 4 0 0 1-4 4H4'],
  /** a pencil: write */
  pen: ['M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z'],
  /** a circle with a question mark: help */
  help: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3', 'M12 17h.01'],
  /** a cog: settings */
  gear: ['M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z', 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z'],
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

/** The quill, as in the favicon (`public/favicon.svg`), drawn as page elements: nothing is loaded, so the "no images" rule and the page's img-src stay true. */
export function logo(size = 24): SVGElement {
  const svg = document.createElementNS(NS, 'svg')
  for (const [k, v] of Object.entries({ viewBox: '0 0 64 64', width: String(size), height: String(size), class: 'logo', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(k, v)
  const part = (tag: string, attrs: Record<string, string>) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); svg.append(e) }
  part('path', { d: 'M53 9 C34 9 17 22 15 46 C32 47 50 34 53 9 Z', fill: '#2dd4bf' })
  part('path', { d: 'M50 12 Q30 26 17 45', fill: 'none', stroke: '#0b0f16', 'stroke-width': '2.6', 'stroke-linecap': 'round' })
  part('path', { d: 'M16 46 L9 57', fill: 'none', stroke: '#2dd4bf', 'stroke-width': '4.5', 'stroke-linecap': 'round' })
  return svg
}
