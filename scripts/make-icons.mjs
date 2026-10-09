// Renders the PNG icons (home-screen icon for iOS, PWA sizes) from the same drawing as public/favicon.svg, full-bleed (iOS rounds the corners itself).
// Usage: node scripts/make-icons.mjs   (needs Playwright's Chromium, as the browser tests do)
import { chromium } from 'playwright'
const drawing = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0b0f16"/><path d="M53 9 C34 9 17 22 15 46 C32 47 50 34 53 9 Z" fill="#2dd4bf"/><path d="M50 12 Q30 26 17 45" fill="none" stroke="#0b0f16" stroke-width="2.6" stroke-linecap="round"/><path d="M16 46 L9 57" fill="none" stroke="#2dd4bf" stroke-width="4.5" stroke-linecap="round"/></svg>`
const browser = await chromium.launch()
for (const [file, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(`<body style="margin:0;background:#0b0f16">${drawing(size)}</body>`)
  await page.screenshot({ path: `public/${file}` })
  await page.close()
}
await browser.close()
console.log('icons written to public/')
