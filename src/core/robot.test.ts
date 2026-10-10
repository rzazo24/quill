import { describe, expect, it } from 'vitest'
import { COMBINATIONS, robotOf } from './robot.js'
import { pixelOf, SIZE } from './pixel.js'
import { pk } from './testutil.js'

const keys = Array.from({ length: 300 }, (_, i) => (i * 2654435761 >>> 0).toString(16).padStart(8, '0').repeat(8))

describe('the robot of a key', () => {
  it('is the same every time, and different keys mostly give different robots', () => {
    expect(robotOf(keys[1]!)).toEqual(robotOf(keys[1]!)); expect(robotOf(keys[1]!.toUpperCase())).toEqual(robotOf(keys[1]!)) // case does not matter
    expect(new Set(keys.map((k) => JSON.stringify(robotOf(k)))).size).toBeGreaterThan(290)
    expect(COMBINATIONS).toBeGreaterThan(100_000)
  })
  it('is always drawable: a hue in range, known shapes only, no empty or odd attributes, nothing external', () => {
    for (const k of [...keys, '', 'zz', 'not a key at all', pk('0'), pk('f')]) {
      const r = robotOf(k); expect(r.hue).toBeGreaterThanOrEqual(0); expect(r.hue).toBeLessThan(360); expect(r.parts.length).toBeGreaterThanOrEqual(5)
      for (const p of r.parts) { expect(['rect', 'circle', 'path', 'line']).toContain(p.tag); for (const [name, v] of Object.entries(p.attrs)) { expect(v, `${p.tag}.${name}`).not.toBe(''); expect(v).not.toMatch(/url\(|https?:|javascript:|<|>/i); expect(name).not.toMatch(/^(on|href|xlink)/i) } }
    }
  })
  it('uses every kind of head, eyes and mouth over many keys (the variety is real)', () => {
    const shapes = new Set(keys.map((k) => robotOf(k).parts.map((p) => p.tag + (p.attrs.d ? 'P' : '') + (p.attrs.rx ?? '')).join(',')))
    expect(shapes.size).toBeGreaterThan(40)
  })
})

describe('the pixel figure of a key', () => {
  it('is the same every time and different for different keys', () => {
    expect(pixelOf(keys[2]!)).toEqual(pixelOf(keys[2]!)); expect(new Set(keys.map((k) => JSON.stringify(pixelOf(k).cells))).size).toBeGreaterThan(280)
  })
  it('is symmetric, a 7 x 7 figure with a body: never empty, never missing its top or bottom row', () => {
    for (const k of [...keys, '', 'zz', pk('0'), pk('f')]) {
      const { cells } = pixelOf(k); expect(cells).toHaveLength(SIZE)
      for (const row of cells) { expect(row).toHaveLength(SIZE); expect(row).toEqual([...row].reverse()) }
      expect(cells[0]!.some(Boolean)).toBe(true); expect(cells[SIZE - 1]!.some(Boolean)).toBe(true); expect(cells.flat().filter(Boolean).length).toBeGreaterThanOrEqual(16)
    }
  })
})

import { CREATURES, spookyOf } from './spooky.js'

describe('the Halloween creature of a key', () => {
  it('is the same every time, and different keys mostly give different pictures', () => {
    expect(spookyOf(keys[3]!)).toEqual(spookyOf(keys[3]!)); expect(spookyOf(keys[3]!.toUpperCase())).toEqual(spookyOf(keys[3]!))
    expect(new Set(keys.map((k) => JSON.stringify(spookyOf(k)))).size).toBeGreaterThan(250)
  })
  it('uses all seven creatures, evenly enough, over many keys', () => {
    const count = new Map<string, number>(); for (const k of keys) { const c = spookyOf(k).creature; count.set(c, (count.get(c) ?? 0) + 1) }
    expect([...count.keys()].sort()).toEqual([...CREATURES].sort()); for (const n of count.values()) expect(n).toBeGreaterThan(15)
  })
  it('is always drawable: known shapes only, numbers that are numbers, nothing external', () => {
    for (const k of [...keys, '', 'zz', 'not a key at all', pk('0'), pk('f')]) {
      const s = spookyOf(k); expect(s.background).toMatch(/^#[0-9a-f]{6}$/); expect(s.parts.length).toBeGreaterThanOrEqual(4)
      for (const p of s.parts) {
        expect(['rect', 'circle', 'ellipse', 'path', 'line']).toContain(p.tag)
        for (const [name, v] of Object.entries(p.attrs)) { expect(v, `${p.tag}.${name}`).not.toBe(''); expect(v).not.toMatch(/NaN|undefined|http|url\(|href/i) }
      }
    }
  })
})
