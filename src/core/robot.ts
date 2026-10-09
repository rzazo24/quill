// A robot for every account, drawn from its public key: the same key always gives the same robot, and nothing is loaded (it is plain shapes). Pure: it returns
// a description of the shapes; `src/ui/robot-el.ts` turns it into page elements.

export interface Part { tag: 'rect' | 'circle' | 'path' | 'line'; attrs: Record<string, string> }
export interface Robot { hue: number; background: string; parts: Part[] }

/** Bytes taken from the key (hex pairs); anything that is not hex still gives something steady. */
function bytesOf(key: string): number[] {
  const out: number[] = []
  for (let i = 0; i + 1 < key.length && out.length < 12; i += 2) { const n = parseInt(key.slice(i, i + 2), 16); out.push(Number.isNaN(n) ? key.charCodeAt(i) & 255 : n) }
  while (out.length < 12) out.push(out.length * 37 & 255)
  return out
}

const HEADS = 4, EYES = 5, MOUTHS = 4, ANTENNAS = 3, EARS = 3
export const COMBINATIONS = HEADS * EYES * MOUTHS * ANTENNAS * EARS * 360

export function robotOf(key: string): Robot {
  const b = bytesOf(key.toLowerCase())
  const hue = ((b[0]! << 8) | b[1]!) % 360
  const skin = `hsl(${hue} 55% 62%)`, dark = `hsl(${hue} 50% 28%)`, glow = `hsl(${(hue + 150) % 360} 85% 70%)`, ink = '#0b0f16'
  const head = b[2]! % HEADS, eyes = b[3]! % EYES, mouth = b[4]! % MOUTHS, antenna = b[5]! % ANTENNAS, ears = b[6]! % EARS
  const parts: Part[] = []
  const add = (tag: Part['tag'], attrs: Record<string, string>) => parts.push({ tag, attrs })

  // shoulders, antenna(s), ears, head, eyes, mouth: back to front
  add('rect', { x: '19', y: '50', width: '26', height: '14', rx: '6', fill: dark })
  if (antenna === 1) { add('line', { x1: '32', y1: '17', x2: '32', y2: '9', stroke: dark, 'stroke-width': '2.5', 'stroke-linecap': 'round' }); add('circle', { cx: '32', cy: '8', r: '3.4', fill: glow }) }
  if (antenna === 2) for (const x of [24, 40]) { add('line', { x1: String(x), y1: '18', x2: String(x + (x < 32 ? -3 : 3)), y2: '10', stroke: dark, 'stroke-width': '2.5', 'stroke-linecap': 'round' }); add('circle', { cx: String(x + (x < 32 ? -3 : 3)), cy: '9', r: '2.6', fill: glow }) }
  if (ears === 1) for (const x of [8, 51]) add('rect', { x: String(x), y: '29', width: '5', height: '11', rx: '2', fill: dark })
  if (ears === 2) for (const x of [10, 54]) add('circle', { cx: String(x), cy: '34', r: '4.2', fill: dark })
  const headFill = { fill: skin, stroke: dark, 'stroke-width': '2' }
  if (head === 0) add('rect', { x: '14', y: '17', width: '36', height: '32', rx: '10', ...headFill })
  else if (head === 1) add('rect', { x: '14', y: '17', width: '36', height: '32', rx: '3', ...headFill })
  else if (head === 2) add('rect', { x: '11', y: '19', width: '42', height: '28', rx: '14', ...headFill })
  else add('path', { d: 'M20 17H44L50 23V43L44 49H20L14 43V23Z', ...headFill })
  if (eyes === 0) for (const x of [25, 39]) add('circle', { cx: String(x), cy: '32', r: '4.2', fill: ink })
  else if (eyes === 1) for (const x of [21, 35]) add('rect', { x: String(x), y: '28', width: '8', height: '8', rx: '1.5', fill: ink })
  else if (eyes === 2) { add('circle', { cx: '32', cy: '32', r: '7.5', fill: ink }); add('circle', { cx: '32', cy: '32', r: '3', fill: glow }) }
  else if (eyes === 3) { add('rect', { x: '19', y: '28', width: '26', height: '8', rx: '4', fill: ink }); add('circle', { cx: '26', cy: '32', r: '1.8', fill: glow }); add('circle', { cx: '38', cy: '32', r: '1.8', fill: glow }) }
  else for (const x of [22, 37]) add('rect', { x: String(x), y: '26', width: '5', height: '11', rx: '2.5', fill: ink })
  if (mouth === 0) add('line', { x1: '25', y1: '42', x2: '39', y2: '42', stroke: ink, 'stroke-width': '3', 'stroke-linecap': 'round' })
  else if (mouth === 1) for (const x of [26, 32, 38]) add('line', { x1: String(x), y1: '39', x2: String(x), y2: '45', stroke: ink, 'stroke-width': '2.4', 'stroke-linecap': 'round' })
  else if (mouth === 2) add('path', { d: 'M24 39Q32 47 40 39', fill: 'none', stroke: ink, 'stroke-width': '3', 'stroke-linecap': 'round' })
  else add('rect', { x: '25', y: '39', width: '14', height: '6', rx: '2', fill: 'none', stroke: ink, 'stroke-width': '2.4' })
  return { hue, background: `hsl(${hue} 42% 22%)`, parts }
}
