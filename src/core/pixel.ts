// An alternative avatar: a symmetric pixel figure drawn from the public key (like the invaders of an old arcade game). The same key always gives the same figure,
// nothing is loaded. Pure: it returns which cells are filled; `src/ui/pixel-el.ts` draws them.

export const SIZE = 7 // 7 x 7 cells, mirrored: 4 columns are chosen, the other 3 are their reflection
export interface Pixel { hue: number; background: string; fill: string; eye: string; cells: boolean[][] }

function bytesOf(key: string): number[] {
  const out: number[] = []
  for (let i = 0; i + 1 < key.length && out.length < 12; i += 2) { const n = parseInt(key.slice(i, i + 2), 16); out.push(Number.isNaN(n) ? key.charCodeAt(i) & 255 : n) }
  while (out.length < 12) out.push(out.length * 53 & 255)
  return out
}

export function pixelOf(key: string): Pixel {
  const b = bytesOf(key.toLowerCase())
  const hue = ((b[0]! << 8) | b[1]!) % 360
  const half = 4, rows = SIZE
  const chosen: boolean[][] = Array.from({ length: rows }, () => Array<boolean>(half).fill(false))
  let bit = 0
  for (let r = 0; r < rows; r++) for (let c = 0; c < half; c++) { chosen[r]![c] = ((b[2 + (bit >> 3)]! >> (bit & 7)) & 1) === 1; bit++ }
  // a figure needs a body: the middle column is always filled in the middle rows, and the top and bottom rows never run empty
  for (let r = 1; r < rows - 1; r++) chosen[r]![half - 1] = true
  if (!chosen[0]!.some(Boolean)) chosen[0]![half - 1] = true
  if (!chosen[rows - 1]!.some(Boolean)) chosen[rows - 1]![0] = true
  // and it needs enough of one: below this many filled cells it looks empty, so the cells nearest the middle are added until it has them
  const MIN_CELLS = 16, count = () => chosen.reduce((n, row, r) => n + row.reduce((m, on, c) => m + (on ? (c === half - 1 ? 1 : 2) : 0), 0), 0)
  for (let c = half - 1; c >= 0 && count() < MIN_CELLS; c--) for (let r = 1; r < rows - 1 && count() < MIN_CELLS; r++) chosen[r]![c] = true
  const cells = chosen.map((row) => [...row, ...[...row].slice(0, half - 1).reverse()])
  return { hue, background: `hsl(${hue} 42% 21%)`, fill: `hsl(${hue} 60% 64%)`, eye: '#0b0f16', cells }
}
