// The pieces of "installable app" must agree with each other: the manifest, the icon files it names, the colours, the page's links and both security
// policies (the meta tag of the build and the header Caddy sends). A mismatch here is silent in the browser: the app just does not install.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url))
const text = (p: string) => read(p).toString('utf8')
const png = (p: string) => { const b = read(p); expect(b.subarray(0, 8).toString('hex'), p).toBe('89504e470d0a1a0a'); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } }
const manifest = JSON.parse(text('public/manifest.webmanifest')) as { name: string; short_name: string; start_url: string; scope: string; display: string; background_color: string; theme_color: string; icons: { src: string; sizes: string; type: string }[] }

describe('the web app manifest', () => {
  it('has what a phone needs to install it as an app', () => {
    expect(manifest.name).toBe('Quill'); expect(manifest.short_name).toBe('Quill')
    expect(manifest.display).toBe('standalone'); expect(manifest.start_url).toBe('/'); expect(manifest.scope).toBe('/')
  })
  it('every icon it names exists and really has the size it declares', () => {
    const pngs = manifest.icons.filter((i) => i.type === 'image/png')
    expect(pngs.map((i) => i.sizes).sort()).toEqual(['192x192', '512x512'])
    for (const i of pngs) { const { w, h } = png(`public${i.src}`); expect(`${w}x${h}`, i.src).toBe(i.sizes) }
    for (const i of manifest.icons) expect(() => read(`public${i.src}`), i.src).not.toThrow()
  })
  it('its colours are the app\'s own: the page background, the meta theme colour', () => {
    const css = text('src/style.css'), html = text('index.html')
    expect(css).toContain(`--bg:${manifest.background_color}`)
    expect(html).toContain(`name="theme-color" content="${manifest.theme_color}"`); expect(manifest.theme_color).toBe(manifest.background_color)
  })
})

describe('the page and the icons', () => {
  it('index.html links the manifest, the icons and the iPhone standalone settings', () => {
    const html = text('index.html')
    for (const needle of ['rel="manifest" href="/manifest.webmanifest"', 'rel="icon" href="/favicon.svg"', 'rel="apple-touch-icon" href="/apple-touch-icon.png"', 'apple-mobile-web-app-capable', 'viewport-fit=cover']) expect(html, needle).toContain(needle)
  })
  it('the iPhone home-screen icon is 180x180; favicon.ico is a PNG that browsers sniff; the SVG favicon is the quill', () => {
    expect(png('public/apple-touch-icon.png')).toEqual({ w: 180, h: 180 })
    expect(png('public/favicon.ico')).toEqual({ w: 32, h: 32 })
    expect(text('public/favicon.svg')).toContain('<svg')
  })
})

describe('both security policies allow the app\'s own manifest and icons, and nothing else new', () => {
  const policies = { 'build meta (vite.config.ts)': text('vite.config.ts'), 'Caddy header (deploy/quill.caddy.template)': text('deploy/quill.caddy.template') }
  for (const [where, src] of Object.entries(policies)) {
    it(where, () => {
      expect(src).toContain("img-src 'self'"); expect(src).toContain("manifest-src 'self'"); expect(src).toContain("default-src 'none'")
      expect(src).toContain("connect-src wss:"); expect(src).toContain("script-src 'self'")
      expect(src).not.toMatch(/img-src[^;"]*(https:|data:|\*)/) // no external or inline images: pictures of strangers stay out
    })
  }
})

describe('the installed app on a notched iPhone', () => {
  it('the header, not the body, is padded below the status bar (a sticky header would otherwise slide under it)', () => {
    const css = text('src/style.css')
    expect(css).toMatch(/\.top \{[^}]*env\(safe-area-inset-top\)/); expect(css).toMatch(/body \{[^}]*padding: 0 env\(safe-area-inset-right\)/)
  })
})
