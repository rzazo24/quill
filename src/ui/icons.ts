// A few small line icons, drawn here so they look the same on every phone (text arrows and symbols are drawn differently by each system's fonts) and
// load nothing. They are DOM elements, not images, so the page's img-src rule does not come into it. All share one style: 24 grid, 2 px round stroke,
// the colour of the text around them.
const NS = 'http://www.w3.org/2000/svg'

const PATHS = {
  /** a speech bubble: a conversation */
  thread: ['M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.2-4.7A8 8 0 1 1 21 12Z'],
  /** a tick: done */
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  /** a chevron pointing right: open */
  chevron: ['M9 18l6-6-6-6'],
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
  /** the quill of the logo (same shape, drawn as an outline): write */
  feather: ['M 18.7 4.0 C 19.7 8.7 17.9 12.0 15.4 13.8 L 13.7 12.9 L 13.9 15.0 C 11.6 16.6 9.5 16.7 8.6 16.0 C 7.8 15.3 7.6 13.2 8.7 10.7 L 10.8 10.5 L 9.6 9.0 C 11.0 6.2 13.9 3.8 18.7 4.0Z', 'M16.1 7.1L5.3 20.0'],
  /** a circle with a question mark: help */
  help: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3', 'M12 17h.01'],
  /** a cog: settings */
  gear: ['M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z', 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z'],
  /** three dots: more choices */
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  /** two arrows chasing each other */
  /** a framed picture: a photo */
  image: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z', 'M11 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z', 'M21 15l-5-5L5 21'],
  /** an arrow into a tray: save a file */
  download: ['M12 3v12', 'M7 10l5 5 5-5', 'M5 21h14'],
  upload: ['M12 15V3', 'M7 8l5-5 5 5', 'M5 21h14'],
  /** a film camera: a video */
  video: ['M4 6h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z', 'M17 10l5-3v10l-5-3'],
  /** a magnifying glass: search */
  search: ['M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z', 'M20 20l-4.2-4.2'],
  /** a star: something the reader cares about */
  star: ['M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z'],
  /** a page of text: an article */
  article: ['M6 3h9l4 4v14H6V3Z', 'M14 3v5h5', 'M9 12h7', 'M9 16h7'],
  /** a lightning bolt: a zap */
  zap: ['M13 2 4 14h7l-1 8 9-12h-7l1-8Z'],
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
export function logo(size = 24, halloween = false): SVGElement {
  const svg = document.createElementNS(NS, 'svg')
  for (const [k, v] of Object.entries({ viewBox: '0 0 64 64', width: String(size), height: String(size), class: 'logo', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(k, v)
  const colour = halloween ? '#ff8a1f' : '#2dd4bf' // a fallback: the page's stylesheet gives it the buttons' colour of the theme in use (inline styles are not allowed by the CSP)
  // a quill: a symmetric vane with a notch on each side, a dark gap along the middle only (the tip and the base stay whole), the shaft down to the nib
  const g = document.createElementNS(NS, 'g'); g.setAttribute('transform', 'rotate(40 32 32)'); svg.append(g)
  const add = (attrs: Record<string, string>) => { const e = document.createElementNS(NS, 'path'); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); g.append(e) }
  add({ d: 'M32 4 C42 12 44 22 42 30 L37 31 L41 35 C39 42 35 46 32 46 C29 46 25 42 23 35 L27 31 L22 30 C20 22 22 12 32 4 Z', fill: colour, class: 'vane' })
  add({ d: 'M32 14 L32 40', stroke: '#0b0f16', class: 'gap', 'stroke-width': '3', 'stroke-linecap': 'round' })
  add({ d: 'M32 15 L32 60', stroke: colour, class: 'shaft', 'stroke-width': '2.2', 'stroke-linecap': 'round' })
  add({ d: 'M32 44 L32 60', stroke: colour, class: 'shaft', 'stroke-width': '3.4', 'stroke-linecap': 'round' })
  return svg
}

/** A small pumpkin for the Halloween theme: plain shapes, nothing loaded. */
export function pumpkin(size = 20): SVGElement {
  const svg = document.createElementNS(NS, 'svg')
  for (const [k, v] of Object.entries({ viewBox: '0 0 64 64', width: String(size), height: String(size), class: 'pumpkin', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(k, v)
  const part = (tag: string, attrs: Record<string, string>) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); svg.append(e) }
  part('path', { d: 'M29 20Q30 9 38 8L39 12Q35 13 35 21Z', fill: '#4a8f2a', stroke: '#2d5a18', 'stroke-width': '2' })
  for (const cx of [20, 44]) part('ellipse', { cx: String(cx), cy: '38', rx: '16', ry: '19', fill: '#ff8a1f', stroke: '#a84a00', 'stroke-width': '2.5' })
  part('ellipse', { cx: '32', cy: '38', rx: '14', ry: '20', fill: '#ff8a1f', stroke: '#a84a00', 'stroke-width': '2.5' })
  part('path', { d: 'M20 36L28 36L24 28ZM36 36L44 36L40 28Z', fill: '#2a1346' })
  part('path', { d: 'M20 44L25 49L29 44L32 49L35 44L39 49L44 44L44 52Q32 58 20 52Z', fill: '#2a1346' })
  return svg
}

/** A cobweb for the corner of the header (Halloween theme): thin lines in the colour of the text around it. */
export function cobweb(): SVGElement {
  const svg = document.createElementNS(NS, 'svg')
  for (const [k, v] of Object.entries({ viewBox: '0 0 64 64', fill: 'none', stroke: 'currentColor', 'stroke-width': '1', 'stroke-linecap': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(k, v)
  for (const d of ['M0 0L60 60', 'M0 0L64 28', 'M0 0L28 64', 'M0 0L64 8', 'M0 0L8 64', 'M0 12Q12 12 12 0', 'M0 26Q24 26 26 0', 'M0 42Q36 40 42 0', 'M0 58Q48 54 58 0']) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.append(p) }
  return svg
}
