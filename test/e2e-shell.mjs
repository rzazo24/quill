// The layout is an app shell: the page never scrolls, only <main> does, so iPhone Safari never shows/hides its toolbar and pushes the tab bar around.
// This checks it in a real (phone-sized) browser against `npm run build`, with a pretend saved Clave connection so the note buttons exist (it points to an
// unreachable relay: nothing is sent anywhere). Usage: node test/e2e-shell.mjs <public key in hex>
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
const ME = process.argv[2] // the public key (hex) of any account that follows some people
if (!/^[0-9a-f]{64}$/i.test(ME ?? '')) { console.error('usage: node ' + process.argv[1] + ' <public key in hex>'); process.exit(2) }
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
// find a scroll position where some note has its top edge AND its buttons on screen (a note taller than the screen would make the test tool scroll to reach them, which says nothing about the app)
const OK_NOTE = (x) => { const r = x.getBoundingClientRect(), a = x.querySelector('.actions')?.getBoundingClientRect(); return r.top > 150 && r.top < 500 && !!a && a.bottom < 700 }
for (const y of [1800, 1500, 2100, 1200, 2400, 900, 2700, 600, 3000, 3300, 3600]) {
  await p.evaluate((y) => { document.querySelector('main.view').scrollTop = y }, y); await new Promise((r) => setTimeout(r, 250))
  if (await p.evaluate((src) => [...document.querySelectorAll('article.note')].some(new Function('return ' + src)()), OK_NOTE.toString())) break
}
const before = await p.evaluate((src) => { const n = [...document.querySelectorAll('article.note')].find(new Function('return ' + src)()); return { id: n.dataset.id, top: Math.round(n.getBoundingClientRect().top), st: document.querySelector('main.view').scrollTop } }, OK_NOTE.toString())
await p.locator(`article.note[data-id^="${before.id.slice(0, 6)}"] button.react`).nth(1).click(); await new Promise((r) => setTimeout(r, 1500))
const after = await p.evaluate((id) => { const n = document.querySelector(`article.note[data-id="${id}"]`); return { top: Math.round(n.getBoundingClientRect().top), st: document.querySelector('main.view').scrollTop } }, before.id)
say(after.top === before.top && after.st === before.st, `reacting does not move the note (top ${before.top} -> ${after.top}, scroll ${before.st} -> ${after.st})`)
for (const hash of ['#/me', '#/mentions']) { await p.goto('http://localhost:4173/' + hash); await new Promise((r) => setTimeout(r, 2500)); s = await probe(); say(!s.docScrolls && s.barBottom === s.vh, `${hash}: page fixed, tab bar at the bottom`) }
// "Loading…" takes no room: the Follows | Network switch must not move while the network loads
await p.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('.seg.feedmode', { timeout: 40000 }); await new Promise((r) => setTimeout(r, 1500))
{ const tops = new Set(); let sawLoading = 0; const t1 = Date.now()
  const sm = (async () => { while (Date.now() - t1 < 8000) { const r = await p.evaluate(() => ({ top: Math.round(document.querySelector('.seg.feedmode')?.getBoundingClientRect().top ?? -1), loading: !!document.querySelector('.status.loading') })); tops.add(r.top); if (r.loading) sawLoading++; await new Promise((r) => setTimeout(r, 40)) } })()
  await p.click('.seg.feedmode button:nth-child(2)'); await sm
  say(tops.size === 1, `the Follows | Network switch stayed put (${[...tops].join(', ')} px) while loading was shown in ${sawLoading} samples`) }
// a very long thread stops indenting: the notes keep a readable width from the fourth level on
{ const w = await p.evaluate(() => { const host = document.createElement('div'); document.querySelector('main.view').prepend(host); let parent = host
    for (let d = 0; d < 10; d++) { const r = document.createElement('div'); r.className = 'reply'; r.dataset.depth = String(Math.min(d, 6)); const a = document.createElement('article'); a.className = 'note'; a.textContent = 'x'; r.append(a); parent.append(r); parent = r }
    const out = [...host.querySelectorAll('article.note')].map((a) => Math.round(a.getBoundingClientRect().width)); host.remove(); return out })
  say(w[9] === w[3] && w[9] >= 250, `a thread 10 levels deep: note widths ${w.join(', ')} (no narrower than level 3, and at least 250 px)`) }
// "Loading…" is for screen readers only: it is not drawn
{ const box = await p.evaluate(() => { const s = document.createElement('p'); s.className = 'status loading'; s.innerHTML = '<span>Loading</span>'; document.querySelector('header.top').append(s); const r = s.getBoundingClientRect(); s.remove(); return [Math.round(r.width), Math.round(r.height)] })
  say(box[0] <= 1 && box[1] <= 1, `the loading message has no visible box (${box.join(' x ')} px)`) }
// every button of the header (refresh, EN, ES, settings, help) is the same height
{ const hs = await p.evaluate(() => [...document.querySelectorAll('header.top button')].map((b) => Math.round(b.getBoundingClientRect().height * 10) / 10))
  say(hs.length >= 5 && new Set(hs).size === 1, `the header buttons are all the same height (${hs.join(', ')} px)`) }
// EN | ES are one fused control: the two halves touch, and only the outer corners are round
{ const l = await p.evaluate(() => { const [a, b] = [...document.querySelectorAll('.lang button')].map((x) => { const r = x.getBoundingClientRect(), c = getComputedStyle(x); return { l: r.left, r: r.right, rad: [c.borderTopLeftRadius, c.borderTopRightRadius] } }); return { gap: Math.round((b.l - a.r) * 10) / 10, leftHalf: a.rad, rightHalf: b.rad } })
  say(l.gap <= 0 && l.leftHalf[1] === '0px' && l.rightHalf[0] === '0px' && l.leftHalf[0] !== '0px' && l.rightHalf[1] !== '0px', `EN | ES are one fused control (gap ${l.gap}px, inner corners square, outer corners round)`) }
// the refresh button turns while loading (instead of a "Loading…" line), stays centred and does not change size
{ await p.click('header.top button[aria-label="Refresh"], header.top button[aria-label="Actualizar"]'); const seen = new Set(); let size = new Set()
  for (let i = 0; i < 6; i++) { const r = await p.evaluate(() => { const b = document.querySelector('header.top button.icon'), v = b.querySelector('svg'); return { spin: b.classList.contains('spinning'), t: getComputedStyle(v).transform, w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) } }); if (r.spin) seen.add(r.t); size.add(`${r.w}x${r.h}`); await new Promise((r) => setTimeout(r, 100)) }
  say(seen.size >= 3 && size.size === 1, `the refresh button turns while loading (${seen.size} different angles) and keeps its size (${[...size].join(', ')})`) }
// notes marked NEW (Mentions): the marker is its own row; the avatar and the text keep their two columns (the text must not be squeezed into the avatar's column)
{ await p.evaluate((me) => localStorage.setItem('seen:' + me, String(Math.floor(Date.now() / 1000) - 5 * 86400)), ME); await p.goto('http://localhost:4173/#/mentions', { waitUntil: 'domcontentloaded' }); await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('.note.new', { timeout: 40000 }).catch(() => {}); await new Promise((r) => setTimeout(r, 1500))
  const cards = await p.evaluate(() => [...document.querySelectorAll('article.note.new')].filter((n) => n.getBoundingClientRect().width > 0).slice(0, 8).map((n) => { const a = n.querySelector('.avatar-link, .avatar').getBoundingClientRect(), m = n.querySelector('.note-main').getBoundingClientRect(); return { sideBySide: Math.abs(m.top - a.top) < 60 && m.left > a.right - 2, width: Math.round(m.width) } }))
  say(cards.length > 0 && cards.every((c) => c.sideBySide && c.width > 200), `new notes keep their layout (${cards.length} checked, text widths ${cards.map((c) => c.width).join(', ')} px)`) }
// the header: the logo and the name are at the same height as the buttons (the centre of what you see, not of a text line with room under it)
await p.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('header.top svg.logo')
const hd = await p.evaluate(() => { const mid = (r) => (r.top + r.bottom) / 2, rg = document.createRange(); rg.selectNodeContents([...document.querySelector('.wordmark').childNodes].find((x) => x.nodeType === 3)); return { logo: mid(document.querySelector('.wordmark .logo').getBoundingClientRect()), name: mid(rg.getBoundingClientRect()), button: mid(document.querySelector('header.top button.icon').getBoundingClientRect()) } })
say(Math.abs(hd.logo - hd.button) <= 1 && Math.abs(hd.name - hd.button) <= 1, `header: logo ${hd.logo.toFixed(1)} / name ${hd.name.toFixed(1)} / buttons ${hd.button.toFixed(1)} are on the same line`)
await b.close(); srv.kill(); process.exit(bad ? 1 : 0)
