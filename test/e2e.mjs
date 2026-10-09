// Real-browser check of the built app against real relays (read-only, public data). Usage: node test/e2e.mjs <npub>
// Needs `npm run build` first. Writes screenshots to .e2e/ (ignored by git).
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const npub = process.argv[2]
if (!npub) throw new Error('usage: node test/e2e.mjs <npub>')
mkdirSync('.e2e', { recursive: true })
const server = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' })
const fail = (m) => { console.log('FAIL', m); process.exitCode = 1 }
const ok = (m) => console.log('ok  ', m)
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch('http://localhost:4173/')).ok) break } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 250)) }
  const browser = await chromium.launch()
  const page = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage()
  const requests = [], errors = []
  page.on('request', (r) => requests.push(r.url()))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 15000 })
  await page.screenshot({ path: '.e2e/1-login.png' })

  await page.fill('input[type=text]', 'nsec1notallowedxx'); await page.click('button[type=submit]')
  ;(await page.locator('.error').count()) ? ok('a private key / junk is refused with a message') : fail('no error for junk input')
  await page.fill('input[type=text]', npub); await page.click('button[type=submit]')
  await page.waitForSelector('.summary', { timeout: 40000 })
  await page.screenshot({ path: '.e2e/2-following.png' })
  const notes = await page.locator('.note').count()
  notes > 10 ? ok(`following feed: ${notes} notes`) : fail(`few notes: ${notes}`)

  await page.click('a.tab:has-text("Mentions")'); await page.waitForSelector('.summary:has-text("shown")', { timeout: 40000 })
  const summary = await page.locator('.summary').innerText()
  ok('mentions summary: ' + summary.replace(/\s+/g, ' '))
  const folds = await page.locator('details.folded').count()
  folds > 0 ? ok(`${folds} folded notes`) : fail('nothing folded in mentions')
  await page.screenshot({ path: '.e2e/3-mentions.png', fullPage: true })
  await page.locator('details.folded > summary').first().click()
  ;(await page.locator('details.folded[open] .body').first().innerText()).length > 0 ? ok('a folded note opens and shows its text') : fail('folded note empty')
  await page.screenshot({ path: '.e2e/4-opened.png' })

  await page.click('button:has-text("Filter settings")'); await page.screenshot({ path: '.e2e/5-settings.png', fullPage: true })
  const before = await page.locator('details.folded').count()
  await page.uncheck('label:has-text("Outside your network") input')
  await page.waitForFunction((n) => document.querySelectorAll('details.folded').length < n, before, { timeout: 15000 })
  ok(`switching "outside your network" off shows more: ${before} -> ${await page.locator('details.folded').count()} folded`)

  await page.locator('a.thread-link').first().click(); await page.waitForSelector('h3', { timeout: 40000 })
  await page.screenshot({ path: '.e2e/6-thread.png', fullPage: true }); ok('thread view opens: ' + (await page.locator('h3').innerText()))

  await page.click('button:has-text("Español")')
  await page.waitForFunction(() => document.body.innerText.includes('respuestas'), null, { timeout: 5000 }).then(() => ok('Spanish works, on content already loaded'), () => fail('no Spanish'))
  await page.screenshot({ path: '.e2e/7-es.png' })

  const external = requests.filter((u) => !u.startsWith('http://localhost:4173') && !u.startsWith('data:') && !u.startsWith('blob:'))
  external.length ? fail('external requests: ' + external.join(', ')) : ok('no requests outside the app itself (relays use WebSocket, not counted here)')
  const media = await page.locator('img, video, audio, iframe, picture, source, object, embed').count()
  media ? fail('media elements: ' + media) : ok('no media elements anywhere')
  errors.length ? fail('console errors: ' + errors.slice(0, 3).join(' | ')) : ok('no console errors (CSP did not block anything either)')
  await browser.close()
} catch (e) { fail(String(e)) } finally { server.kill() }
