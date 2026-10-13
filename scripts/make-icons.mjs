// Renders the PNG icons (home-screen icon for iOS, PWA sizes) from the same drawing as public/favicon.svg, full-bleed (iOS rounds the corners itself).
// Usage: node scripts/make-icons.mjs   (needs Playwright's Chromium, as the browser tests do)
import { chromium } from 'playwright'
const drawing = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0b0f16"/><g transform="rotate(40 32 32)"><path d="M32 4 C42 12 44 22 42 30 L37 31 L41 35 C39 42 35 46 32 46 C29 46 25 42 23 35 L27 31 L22 30 C20 22 22 12 32 4 Z" fill="#2dd4bf"/><path d="M32 14 L32 40" stroke="#0b0f16" stroke-width="3" stroke-linecap="round"/><path d="M32 15 L32 60" stroke="#2dd4bf" stroke-width="2.2" stroke-linecap="round"/><path d="M32 44 L32 60" stroke="#2dd4bf" stroke-width="3.4" stroke-linecap="round"/></g></svg>`
const browser = await chromium.launch()
for (const [file, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512], ['favicon.ico', 32]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(`<body style="margin:0;background:#0b0f16">${drawing(size)}</body>`)
  await page.screenshot({ path: `public/${file}`, type: 'png' }) // favicon.ico is a PNG inside: every browser sniffs it
  await page.close()
}
await browser.close()
console.log('icons written to public/')
