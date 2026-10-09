// Desktop alignment: header, feed and tab bar must share the same column even when the browser shows a classic scrollbar (Playwright hides scrollbars by
// default, which once hid a 10-15px misalignment). Usage: node test/e2e-align.mjs <npub hex> (needs `npm run build`)
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
const ME = process.argv[2] ?? '67a69f6937afaa0ab6604c833b1010da2b12ce9c714c59342c16f68c098375f1'
const srv = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' })
for (let i = 0; i < 40; i++) { try { if ((await fetch('http://localhost:4173/')).ok) break } catch {} await new Promise((r) => setTimeout(r, 250)) }
// Playwright hides scrollbars by default; a desktop browser shows classic ones (about 15px) that take room from the content
const b = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
let bad = 0
for (const [w, h] of [[1440, 900], [1100, 800], [900, 700]]) {
  const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage()
  await p.addInitScript(({ me }) => { localStorage.setItem('me', me); localStorage.setItem('lang', 'es') }, { me: ME })
  await p.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('.summary', { timeout: 40000 }); await new Promise((r) => setTimeout(r, 600))
  const m = await p.evaluate(() => { const box = (s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { l: Math.round(r.left * 10) / 10, r: Math.round(r.right * 10) / 10 } : null }
    const main = document.querySelector('main.view'); return { scrollbar: main.offsetWidth - main.clientWidth, bar: box('nav.tabbar'), card: box('.summary'), brand: box('.top .brand'), controls: box('.top .lang'), vw: innerWidth } })
  const dl = Math.abs(m.bar.l - m.card.l), dr = Math.abs(m.bar.r - m.card.r), db = Math.abs(m.brand.l - m.card.l)
  const ok = dl <= 1 && dr <= 1 && db <= 1
  console.log(`${w}px (scrollbar ${m.scrollbar}px): tab bar ${m.bar.l}..${m.bar.r} | feed card ${m.card.l}..${m.card.r} | brand starts ${m.brand.l} -> ${ok ? 'aligned' : 'OFF by ' + Math.max(dl, dr, db) + 'px'}`)
  if (!ok) bad++
}
await b.close(); srv.kill(); process.exit(bad ? 1 : 0)
