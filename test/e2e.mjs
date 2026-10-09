// Real-browser check of the built app against real relays (read-only, public data). Usage: node test/e2e.mjs <npub>
// Needs `npm run build` first. Writes screenshots to .e2e/ (ignored by git).
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const npub = process.argv[2]
if (!npub) throw new Error('usage: node test/e2e.mjs <npub>')
mkdirSync('.e2e', { recursive: true })
// QUILL_URL=https://quill.example QUILL_IP=1.2.3.4 tests a deployed copy (the IP skips a stale local DNS cache); without it, a local `vite preview`.
const BASE = process.env.QUILL_URL ?? 'http://localhost:4173'
const server = process.env.QUILL_URL ? { kill() {} } : spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' })
const fail = (m) => { console.log('FAIL', m); process.exitCode = 1 }
const ok = (m) => console.log('ok  ', m)
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/')).ok) break } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 250)) }
  const host = process.env.QUILL_URL ? new URL(process.env.QUILL_URL).hostname : null
  const browser = await chromium.launch(host && process.env.QUILL_IP ? { args: [`--host-resolver-rules=MAP ${host} ${process.env.QUILL_IP}`] } : {})
  const page = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage()
  const requests = [], errors = []
  page.on('request', (r) => requests.push(r.url()))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 15000 })
  await page.screenshot({ path: '.e2e/1-login.png' })

  await page.fill('input[type=text]', 'nsec1notallowedxx'); await page.click('button[type=submit]')
  ;(await page.locator('.error').count()) ? ok('a private key / junk is refused with a message') : fail('no error for junk input')
  await page.fill('input[type=text]', npub); await page.click('button[type=submit]')
  await page.waitForSelector('.summary', { timeout: 40000 })
  await page.screenshot({ path: '.e2e/2-following.png' })
  const notes = await page.locator('.note').count()
  notes > 10 ? ok(`following feed: ${notes} notes`) : fail(`few notes: ${notes}`)

  // signing UI (on the Me page): the link for Clave appears, and nothing is signed or published (we never approve it)
  await page.click('nav.tabbar a[href="#/me"]')
  await page.click('button:has-text("Connect Clave")') // opens the panel: the bunker:// address comes first
  await page.click('.by-link summary') // "Use a link instead" starts closed
  await page.click('.by-link button:has-text("Connect Clave")')
  const href = await page.locator('a.button').getAttribute('href')
  ;/^https:\/\/clave\.casa\/connect\/\?uri=nostrconnect/.test(href ?? '') ? ok('Connect Clave offers a clave.casa link') : fail('no Clave link: ' + href)
  ;(await page.locator('.sign').innerText()).includes('Waiting for Clave') ? ok('and says it is waiting for Clave') : fail('no waiting message')
  await page.screenshot({ path: '.e2e/2b-connect.png' })
  await page.click('.connect button:has-text("Cancel")')
  ;(await page.locator('.account .avatar').innerText()).length >= 1 ? ok('the Me page shows the account with its generated avatar') : fail('no avatar on Me')
  await page.click('nav.tabbar a[href="#/mentions"]'); await page.waitForSelector('.summary:has-text("shown")', { timeout: 40000 })
  const summary = await page.locator('.summary').innerText()
  ok('mentions summary: ' + summary.replace(/\s+/g, ' '))
  const folds = await page.locator('details.folded').count()
  folds > 0 ? ok(`${folds} folded notes`) : fail('nothing folded in mentions')
  await page.screenshot({ path: '.e2e/3-mentions.png', fullPage: true })
  await page.locator('details.folded > summary').first().click()
  ;(await page.locator('details.folded[open] .body').first().innerText()).length > 0 ? ok('a folded note opens and shows its text') : fail('folded note empty')
  await page.screenshot({ path: '.e2e/4-opened.png' })

  const before = await page.locator('details.folded').count()
  await page.click('button:has-text("Filter settings")') // goes to the Me page, where the settings live
  await page.uncheck('label:has-text("Outside your network") input')
  await page.screenshot({ path: '.e2e/5-settings.png' })
  await page.click('nav.tabbar a[href="#/mentions"]'); await page.waitForSelector('.summary:has-text("shown")', { timeout: 40000 })
  await page.waitForFunction((n) => document.querySelectorAll('details.folded').length < n, before, { timeout: 20000 })
  ok(`switching "outside your network" off shows more: ${before} -> ${await page.locator('details.folded').count()} folded`)

  await page.locator('a.thread-link').first().click(); await page.waitForSelector('h3', { timeout: 40000 })
  await page.screenshot({ path: '.e2e/6-thread.png', fullPage: true }); ok('thread view opens: ' + (await page.locator('h3').innerText()))

  await page.click('.lang button:has-text("ES")')
  await page.waitForFunction(() => document.body.innerText.includes('respuestas'), null, { timeout: 5000 }).then(() => ok('Spanish works, on content already loaded'), () => fail('no Spanish'))
  await page.screenshot({ path: '.e2e/7-es.png' })

  const external = requests.filter((u) => !u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:'))
  external.length ? fail('external requests: ' + external.join(', ')) : ok('no requests outside the app itself (relays use WebSocket, not counted here)')
  const media = await page.locator('img, video, audio, iframe, picture, source, object, embed').count()
  media ? fail('media elements: ' + media) : ok('no media elements anywhere')
  errors.length ? fail('console errors: ' + errors.slice(0, 3).join(' | ')) : ok('no console errors (CSP did not block anything either)')
  await browser.close()
} catch (e) { fail(String(e)) } finally { server.kill() }
