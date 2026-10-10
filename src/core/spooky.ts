// A Halloween creature for every account, drawn from its public key: the same key always gives the same one, and nothing is loaded (plain shapes).
// Pure: it returns a description of the shapes; `src/ui/spooky-el.ts` turns it into page elements. Seven creatures, each with its own faces, plus a night
// sky behind and a bit of decoration, so many keys give different pictures.

export interface Part { tag: 'rect' | 'circle' | 'ellipse' | 'path' | 'line'; attrs: Record<string, string> }
export interface Spooky { creature: Creature; background: string; parts: Part[] }
export const CREATURES = ['pumpkin', 'ghost', 'bat', 'skull', 'cat', 'spider', 'witch'] as const
export type Creature = (typeof CREATURES)[number]

/** Bytes taken from the key (hex pairs); anything that is not hex still gives something steady. */
function bytesOf(key: string): number[] {
  const out: number[] = []
  for (let i = 0; i + 1 < key.length && out.length < 12; i += 2) { const n = parseInt(key.slice(i, i + 2), 16); out.push(Number.isNaN(n) ? key.charCodeAt(i) & 255 : n) }
  while (out.length < 12) out.push(out.length * 37 & 255)
  return out
}

const NIGHTS = ['#4b2a7b', '#b45309', '#1e4d3a', '#243b73'] // purple, burnt orange, deep green, midnight blue
const INK = '#1a1026', BONE = '#efe9d8', GLOW = '#ffd23f'

export function spookyOf(key: string): Spooky {
  const b = bytesOf(key.toLowerCase())
  const creature = CREATURES[b[2]! % CREATURES.length]!
  const night = b[0]! % NIGHTS.length, look = b[3]! % 3, mouth = b[4]! % 3, hue = b[1]! % 40, extra = b[5]! % 3, decor = b[7]! % 4
  const background = NIGHTS[night]!
  const parts: Part[] = []
  const add = (tag: Part['tag'], attrs: Record<string, string>) => parts.push({ tag, attrs })
  const stroke = (color: string, w = '2') => ({ fill: 'none', stroke: color, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })

  // the sky: nothing, a moon, three stars, or a cobweb in the corner
  if (decor === 1) { add('circle', { cx: '51', cy: '13', r: '6.5', fill: '#f6efc0' }); add('circle', { cx: '54', cy: '11', r: '5.5', fill: background }) }
  if (decor === 2) for (const [x, y, r] of [[12, 12, 1.6], [53, 20, 1.2], [47, 8, 1.4]] as const) add('circle', { cx: String(x), cy: String(y), r: String(r), fill: '#f6efc0' })
  if (decor === 3) add('path', { d: 'M0 0L20 20M0 9Q8 8 9 0M0 17Q12 15 15 0M12 12L0 21', ...stroke('#d9d2e9', '1') })

  if (creature === 'pumpkin') {
    const skin = `hsl(${22 + hue / 2} 90% 52%)`, dark = `hsl(${18 + hue / 2} 80% 30%)`
    add('path', { d: 'M29 24Q30 14 37 13L38 16Q34 17 34 25Z', fill: '#4a8f2a', stroke: '#2d5a18', 'stroke-width': '1.5' })
    for (const cx of [22, 42]) add('ellipse', { cx: String(cx), cy: '39', rx: '13', ry: '15', fill: skin, stroke: dark, 'stroke-width': '2' })
    add('ellipse', { cx: '32', cy: '39', rx: '12', ry: '16.5', fill: skin, stroke: dark, 'stroke-width': '2' })
    if (look === 0) for (const d of ['M21 35L29 35L25 28Z', 'M35 35L43 35L39 28Z']) add('path', { d, fill: INK })
    else if (look === 1) for (const cx of [25, 39]) add('circle', { cx: String(cx), cy: '33', r: '4', fill: INK })
    else for (const d of ['M20 30L29 35L21 37Z', 'M44 30L35 35L43 37Z']) add('path', { d, fill: INK })
    if (mouth === 0) add('path', { d: 'M21 43L25 47L29 43L32 47L35 43L39 47L43 43L43 50Q32 55 21 50Z', fill: INK })
    else if (mouth === 1) add('path', { d: 'M22 43Q32 56 42 43Z', fill: INK })
    else add('circle', { cx: '32', cy: '47', r: '4.2', fill: INK })
    if (extra === 1) for (const cx of [25, 39]) add('circle', { cx: String(cx), cy: String(look === 0 ? 33 : 33), r: '1.4', fill: GLOW })
  } else if (creature === 'ghost') {
    const sheet = `hsl(${200 + hue} 35% 95%)`
    add('path', { d: 'M15 54V30Q15 11 32 11Q49 11 49 30V54L43.5 49L38 54L32 49L26 54L20.5 49Z', fill: sheet, stroke: '#c9c2dd', 'stroke-width': '1.5' })
    if (look === 0) for (const cx of [25, 39]) add('ellipse', { cx: String(cx), cy: '29', rx: '3', ry: '4.6', fill: INK })
    else if (look === 1) for (const cx of [25, 39]) add('circle', { cx: String(cx), cy: '29', r: '3.6', fill: INK })
    else for (const x of [21, 35]) add('path', { d: `M${x} 29Q${x + 4} 33 ${x + 8} 29`, ...stroke(INK, '2.4') })
    if (mouth === 0) add('ellipse', { cx: '32', cy: '40', rx: '3.6', ry: '4.8', fill: INK })
    else if (mouth === 1) add('path', { d: 'M26 38Q32 45 38 38', ...stroke(INK, '2.4') })
    else add('path', { d: 'M25 40Q28.5 36 32 40Q35.5 44 39 40', ...stroke(INK, '2.4') })
    if (extra === 1) for (const cx of [19, 45]) add('circle', { cx: String(cx), cy: '36', r: '3', fill: '#ffb3c7', opacity: '.7' })
  } else if (creature === 'bat') {
    const wing = '#241638', edge = '#7c5bb5'
    add('path', { d: 'M32 30Q22 17 5 21Q10 27 8 34Q14 31 17 37Q21 34 25 40Q29 36 32 39Z', fill: wing, stroke: edge, 'stroke-width': '1.5', 'stroke-linejoin': 'round' })
    add('path', { d: 'M32 30Q42 17 59 21Q54 27 56 34Q50 31 47 37Q43 34 39 40Q35 36 32 39Z', fill: wing, stroke: edge, 'stroke-width': '1.5', 'stroke-linejoin': 'round' })
    add('path', { d: 'M25 28L26 17L31 24ZM39 28L38 17L33 24Z', fill: '#2f1d4d', stroke: edge, 'stroke-width': '1.2', 'stroke-linejoin': 'round' })
    add('ellipse', { cx: '32', cy: '35', rx: '8.5', ry: '11.5', fill: '#2f1d4d', stroke: edge, 'stroke-width': '1.5' })
    const eye = ['#ffd23f', '#ff5a5a', '#7dff8a'][look]!
    for (const cx of [28.5, 35.5]) add('circle', { cx: String(cx), cy: '32', r: '2.4', fill: eye })
    if (mouth === 0) { add('path', { d: 'M28.5 39L29.7 43.5L31 39Z', fill: BONE }); add('path', { d: 'M33 39L34.3 43.5L35.5 39Z', fill: BONE }) }
    else if (mouth === 1) add('path', { d: 'M28 39Q32 43 36 39', ...stroke(BONE, '1.6') })
    else add('line', { x1: '29', y1: '40', x2: '35', y2: '40', ...stroke(BONE, '1.6') })
  } else if (creature === 'skull') {
    add('path', { d: 'M15 34Q15 11 32 11Q49 11 49 34Q49 40 45 43V51H19V43Q15 40 15 34Z', fill: BONE, stroke: '#a89f86', 'stroke-width': '1.5', 'stroke-linejoin': 'round' })
    if (look === 0) for (const cx of [25, 39]) add('circle', { cx: String(cx), cy: '33', r: '5.4', fill: INK })
    else if (look === 1) for (const x of [20, 34]) add('rect', { x: String(x), y: '28', width: '10', height: '10', rx: '3', fill: INK })
    else for (const d of ['M19 29L30 34L21 38Z', 'M45 29L34 34L43 38Z']) add('path', { d, fill: INK })
    add('path', { d: 'M32 38L28.8 45H35.2Z', fill: INK })
    if (mouth === 0) { add('line', { x1: '21', y1: '47.5', x2: '43', y2: '47.5', ...stroke(INK, '1.6') }); for (const x of [25, 29, 32, 35, 39]) add('line', { x1: String(x), y1: '45', x2: String(x), y2: '51', ...stroke(INK, '1.6') }) }
    else if (mouth === 1) for (const x of [24, 28, 32, 36, 40]) add('line', { x1: String(x), y1: '46', x2: String(x), y2: '51', ...stroke(INK, '1.8') })
    else add('path', { d: 'M22 47Q32 52 42 47', ...stroke(INK, '1.8') })
    if (extra === 1) add('path', { d: 'M38 11L35 18L39 23L36 28', ...stroke(INK, '1.4') })
  } else if (creature === 'cat') {
    const fur = '#17111f', rim = '#7c5bb5'
    add('path', { d: 'M17 32L17 12L31 23ZM47 32L47 12L33 23Z', fill: fur, stroke: rim, 'stroke-width': '1.5', 'stroke-linejoin': 'round' })
    add('path', { d: 'M20 25L20 18L26 23ZM44 25L44 18L38 23Z', fill: '#ff9db8' })
    add('ellipse', { cx: '32', cy: '37', rx: '17', ry: '15', fill: fur, stroke: rim, 'stroke-width': '1.5' })
    const iris = ['#ffd23f', '#7dff8a', '#ff9a3c'][look]!
    for (const cx of [25, 39]) { add('ellipse', { cx: String(cx), cy: '35', rx: '4', ry: '4.8', fill: iris }); add('line', { x1: String(cx), y1: '31', x2: String(cx), y2: '39.4', ...stroke(INK, '2') }) }
    add('path', { d: 'M29.5 41H34.5L32 44Z', fill: '#ff9db8' })
    if (mouth === 0) add('path', { d: 'M32 44Q29 48 26 46M32 44Q35 48 38 46', ...stroke('#ff9db8', '1.4') })
    else if (mouth === 1) add('path', { d: 'M32 44V47M27 49Q32 46 37 49', ...stroke('#ff9db8', '1.4') })
    else add('path', { d: 'M32 44Q32 48 29 49M32 44Q32 48 35 49', ...stroke('#ff9db8', '1.4') })
    if (extra !== 0) for (const [x1, y1, x2, y2] of [[15, 40, 6, 38], [15, 44, 6, 45], [49, 40, 58, 38], [49, 44, 58, 45]] as const) add('line', { x1: String(x1), y1: String(y1), x2: String(x2), y2: String(y2), ...stroke('#cbbbe6', '1') })
  } else if (creature === 'spider') {
    add('line', { x1: '32', y1: '0', x2: '32', y2: '24', ...stroke('#d9d2e9', '1.2') })
    const leg = '#120c1c'
    for (const s of [-1, 1]) for (const [dy, kx, ky, fx, fy] of [[-3, 14, 14, 8, 22], [1, 12, 28, 5, 34], [5, 12, 40, 7, 48], [9, 16, 49, 12, 57]] as const) {
      const x0 = 32 + s * 4, y0 = 36 + dy
      add('path', { d: `M${x0} ${y0}Q${32 + s * (32 - kx) * 0.9} ${ky} ${32 + s * (32 - fx)} ${fy}`, ...stroke(leg, '2.2') })
    }
    add('circle', { cx: '32', cy: '39', r: '10', fill: '#1d1430', stroke: '#7c5bb5', 'stroke-width': '1.5' })
    add('circle', { cx: '32', cy: '28', r: '6.6', fill: '#241a3a', stroke: '#7c5bb5', 'stroke-width': '1.5' })
    if (look === 0) for (const [cx, cy, r] of [[29.5, 27, 1.5], [34.5, 27, 1.5], [30.5, 30, 1], [33.5, 30, 1]] as const) add('circle', { cx: String(cx), cy: String(cy), r: String(r), fill: '#ff4d4d' })
    else if (look === 1) for (const cx of [29.3, 34.7]) add('circle', { cx: String(cx), cy: '28', r: '2.4', fill: '#fff', stroke: INK, 'stroke-width': '0.8' })
    else for (const cx of [29.5, 34.5]) add('circle', { cx: String(cx), cy: '28', r: '1.8', fill: '#7dff8a' })
    if (extra !== 0) add('path', { d: 'M28.8 35H35.2L32 39L35.2 44H28.8L32 39Z', fill: '#ff4d4d' })
  } else {
    const skin = `hsl(${95 + hue} 45% 62%)`
    add('ellipse', { cx: '32', cy: '47', rx: '12', ry: '10', fill: '#2b1b47' })
    add('circle', { cx: '32', cy: '41', r: '11.5', fill: skin, stroke: '#4d7a3b', 'stroke-width': '1.5' })
    const hat = ['#5b2b9b', '#222', '#8a2b9b'][look]!
    add('path', { d: 'M17 31Q32 27 47 31L32 3Z', fill: hat, stroke: INK, 'stroke-width': '1.2', 'stroke-linejoin': 'round' })
    add('ellipse', { cx: '32', cy: '31', rx: '21', ry: '4.6', fill: hat, stroke: INK, 'stroke-width': '1.2' })
    add('path', { d: 'M23 28Q32 25 41 28L40.2 31Q32 29 23.8 31Z', fill: '#ffb000' })
    for (const cx of [27, 37]) { add('circle', { cx: String(cx), cy: '40', r: '2.4', fill: '#fff' }); add('circle', { cx: String(cx), cy: '40.4', r: '1.2', fill: INK }) }
    add('path', { d: 'M32 42.5L30 46.5H33.2', ...stroke('#3d6b2c', '1.4') })
    if (mouth === 0) add('path', { d: 'M26 48Q32 53 38 48', ...stroke(INK, '1.8') })
    else if (mouth === 1) { add('path', { d: 'M26 48Q32 54 38 48Z', fill: INK }); add('path', { d: 'M29 49.2H31V51H29Z', fill: BONE }) }
    else add('line', { x1: '27', y1: '49', x2: '37', y2: '49', ...stroke(INK, '1.8') })
    if (extra === 1) add('circle', { cx: '37', cy: '45', r: '1.1', fill: '#3d6b2c' })
  }
  return { creature, background, parts }
}
