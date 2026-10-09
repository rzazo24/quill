// Asks a real Chromium whether the page is installable as an app and whether its manifest parses, through the DevTools protocol.
// Usage: node test/e2e-pwa.mjs            (builds nothing: needs `npm run build`; serves dist with `vite preview`)
//        QUILL_URL=https://quill.example QUILL_IP=1.2.3.4 node test/e2e-pwa.mjs   (a deployed copy)
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const BASE = process.env.QUILL_URL ?? 'http://localhost:4173'
const server = process.env.QUILL_URL ? { kill() {} } : spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' })
for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/')).ok) break } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 250)) }
const host = new URL(BASE).hostname
const browser = await chromium.launch(process.env.QUILL_IP ? { args: [`--host-resolver-rules=MAP ${host} ${process.env.QUILL_IP}`] } : {})
const page = await browser.newPage()
const bad = []
page.on('console', (m) => { if (m.type() === 'error') bad.push(m.text()) })
let code = 0
const ok = (m) => console.log('ok  ', m), fail = (m) => { console.log('FAIL', m); code = 1 }
try {
  await page.goto(BASE + '/', { waitUntil: 'load', timeout: 20000 })
  const cdp = await page.context().newCDPSession(page)
  const { url, errors, data } = await cdp.send('Page.getAppManifest')
  errors.length ? fail('manifest errors: ' + JSON.stringify(errors)) : ok('the manifest was found at ' + url + ' and parses without errors')
  const m = JSON.parse(data || '{}')
  m.display === 'standalone' && m.name === 'Quill' && m.icons?.length >= 2 ? ok(`name ${m.name}, display ${m.display}, ${m.icons.length} icons`) : fail('manifest content unexpected: ' + data)
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors')
  installabilityErrors.length ? fail('not installable: ' + installabilityErrors.map((e) => e.errorId).join(', ')) : ok('Chromium considers the page installable')
  for (const path of ['/favicon.svg', '/favicon.ico', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest']) {
    const r = await page.request.get(BASE + path)
    r.ok() ? ok(`${path} -> ${r.status()} ${r.headers()['content-type'] ?? ''}`) : fail(`${path} -> ${r.status()}`)
  }
  const icons = await page.evaluate(() => [...document.querySelectorAll('link[rel~=icon], link[rel=apple-touch-icon]')].map((l) => l.getAttribute('href')))
  icons.length >= 2 ? ok('the page links its icons: ' + icons.join(', ')) : fail('icon links missing')
  // updates: /version.json names this build, the bundle carries the same id, and a newer id makes the app offer an update
  const vr = await page.request.get(BASE + '/version.json'); const v = await vr.json()
  ;/^[a-z0-9]{4,20}$/.test(v.build ?? '') ? ok(`/version.json -> build ${v.build} (cache-control: ${vr.headers()['cache-control'] ?? 'none'})`) : fail('bad version.json: ' + JSON.stringify(v))
  const bundle = await (await page.request.get(BASE + (await page.evaluate(() => document.querySelector('script[type=module]').getAttribute('src'))))).text()
  bundle.includes(v.build) ? ok('the running bundle carries the same build id') : fail('the bundle does not contain the build id from version.json')
  ;(await page.locator('.update').count()) === 0 ? ok('no update banner when the server has the same build') : fail('banner shown for the same build')
  await page.route('**/version.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ build: 'zznewbuild1' }) }))
  await page.evaluate(() => { window.__marker = 1 })
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('.update', { timeout: 10000 }).then(() => ok('a newer build on the server makes the banner appear'), () => fail('no banner for a newer build'))
  await page.evaluate(() => { window.__marker = 1 })
  await page.click('.update button'); await page.waitForLoadState('load'); await new Promise((r) => setTimeout(r, 500))
  ;(await page.evaluate(() => window.__marker)) === undefined ? ok('the Update button reloads the page') : fail('the page was not reloaded')
  bad.length ? fail('console errors (a security policy blocking the manifest or an icon would show here): ' + bad.slice(0, 3).join(' | ')) : ok('no console errors')
} catch (e) { fail(String(e)) } finally { await browser.close(); server.kill() }
process.exit(code)
