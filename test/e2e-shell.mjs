// The layout is an app shell: the page never scrolls, only <main> does, so iPhone Safari never shows/hides its toolbar and pushes the tab bar around.
// This checks it in a real (phone-sized) browser against `npm run build`, with a pretend saved Clave connection so the note buttons exist (it points to an
// unreachable relay: nothing is sent anywhere). Usage: node test/e2e-shell.mjs <npub hex>   (default: the author's)
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
const ME = process.argv[2] ?? '67a69f6937afaa0ab6604c833b1010da2b12ce9c714c59342c16f68c098375f1'
const srv = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' })
for (let i = 0; i < 40; i++) { try { if ((await fetch('http://localhost:4173/')).ok) break } catch {} await new Promise((r) => setTimeout(r, 250)) }
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const p = await ctx.newPage()
await p.addInitScript(({ me }) => { localStorage.setItem('me', me); localStorage.setItem('lang', 'es'); localStorage.setItem('signer', JSON.stringify({ clientSecret: 'ab'.repeat(32), signerPubkey: me, relays: ['wss://127.0.0.1:9'], userPubkey: me })) }, { me: ME })
let bad = 0; const say = (ok, m) => { console.log(ok ? 'ok  ' : 'FAIL', m); if (!ok) bad++ }
const probe = () => p.evaluate(() => { const bar = document.querySelector('nav.tabbar'), main = document.querySelector('main.view'); const r = bar?.getBoundingClientRect(); return { docScrolls: document.scrollingElement.scrollHeight > innerHeight + 1, windowScrollY: scrollY, barBottom: r ? Math.round(r.bottom) : null, vh: innerHeight, mainTop: main ? Math.round(main.scrollTop) : null } })
await p.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('.note .actions', { timeout: 40000 }); await new Promise((r) => setTimeout(r, 600))
let s = await probe(); say(!s.docScrolls && s.barBottom === s.vh, `Following: the page does not scroll and the tab bar sits at the very bottom (bar ${s.barBottom} / viewport ${s.vh})`)
// scroll the content, then switch to Mentions and sample the footer all through the loading
await p.evaluate(() => { document.querySelector('main.view').scrollTop = 2500 }); await new Promise((r) => setTimeout(r, 300))
s = await probe(); say(s.mainTop > 1000 && s.windowScrollY === 0, `scrolling moves <main> (${s.mainTop}px), never the window (${s.windowScrollY})`)
const samples = []; const t0 = Date.now()
const sampler = (async () => { while (Date.now() - t0 < 12000) { samples.push(await probe()); await new Promise((r) => setTimeout(r, 40)) } })()
await p.click('nav.tabbar a[href="#/mentions"]'); await p.waitForSelector('.summary', { timeout: 40000 }); await sampler
say(samples.length > 20 && samples.every((x) => x.barBottom === x.vh), `Menciones: the tab bar never moved in ${samples.length} samples taken while it loaded`)
say(samples.every((x) => !x.docScrolls), 'and the page itself never became scrollable meanwhile')
s = await probe(); say(s.mainTop === 0, `a new view starts at the top (scrollTop ${s.mainTop})`)
// react in the middle of a long list: nothing may jump
await p.click('nav.tabbar a[href="#/"]'); await p.waitForSelector('.note .actions'); await new Promise((r) => setTimeout(r, 600))
await p.evaluate(() => { document.querySelector('main.view').scrollTop = 1800 }); await new Promise((r) => setTimeout(r, 300))
const before = await p.evaluate(() => { const n = [...document.querySelectorAll('article.note')].find((x) => x.getBoundingClientRect().top > 200 && x.getBoundingClientRect().top < 500); return { id: n.dataset.id, top: Math.round(n.getBoundingClientRect().top), st: document.querySelector('main.view').scrollTop } })
await p.locator(`article.note[data-id^="${before.id.slice(0, 6)}"] button.react`).nth(1).click(); await new Promise((r) => setTimeout(r, 1500))
const after = await p.evaluate((id) => { const n = document.querySelector(`article.note[data-id="${id}"]`); return { top: Math.round(n.getBoundingClientRect().top), st: document.querySelector('main.view').scrollTop } }, before.id)
say(after.top === before.top && after.st === before.st, `reacting does not move the note (top ${before.top} -> ${after.top}, scroll ${before.st} -> ${after.st})`)
for (const hash of ['#/me', '#/mentions']) { await p.goto('http://localhost:4173/' + hash); await new Promise((r) => setTimeout(r, 2500)); s = await probe(); say(!s.docScrolls && s.barBottom === s.vh, `${hash}: page fixed, tab bar at the bottom`) }
await b.close(); srv.kill(); process.exit(bad ? 1 : 0)
