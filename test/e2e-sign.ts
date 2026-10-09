// Real browser + pretend Clave: does the connection handshake end in "Signing as …" on the DEPLOYED page? (Nothing is published: the pretend signer
// only answers the connection and the identity request, over the same relays Clave uses.) Usage:
//   QUILL_URL=https://quill.example QUILL_IP=1.2.3.4 npm run e2e:sign
import { chromium } from 'playwright'
import WebSocket from 'ws'
import { useWebSocketImplementation } from 'nostr-tools/pool'
import { nip19 } from 'nostr-tools'
import { FakeSigner } from './support/fake-signer.js'

useWebSocketImplementation(WebSocket)
const BASE = process.env.QUILL_URL ?? 'http://localhost:4173'
const host = new URL(BASE).hostname
const browser = await chromium.launch(process.env.QUILL_IP ? { args: [`--host-resolver-rules=MAP ${host} ${process.env.QUILL_IP}`] } : {})
const page = await browser.newPage()
const logs: string[] = []
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`.slice(0, 200)))
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 200)))
const fake = new FakeSigner({ delayMs: 50 })
let code = 0
try {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 20000 })
  await page.click('button:has-text("Connect Clave")') // opens the panel (the bunker:// address comes first)
  await page.click('.by-link summary') // "Use a link instead" starts closed
  await page.click('.by-link button:has-text("Connect Clave")') // the link way
  const href = (await page.locator('a.button').getAttribute('href')) ?? ''
  const uri = decodeURIComponent(href.replace(/^.*\?uri=/, ''))
  console.log('link params:', [...new URL(uri).searchParams.keys()].join(','), '| relays:', new URL(uri).searchParams.getAll('relay').join(' '))
  // The real mistake: clicking "Open in Clave" used to replace Quill's own tab, throwing away the pending connection Clave was about to answer.
  await page.route(/clave\.casa/, (r) => r.abort())
  const [popup] = await Promise.all([page.waitForEvent('popup', { timeout: 10000 }).catch(() => null), page.click('a.button')])
  const stayed = page.url().startsWith(BASE) && (await page.locator('.sign').innerText()).includes('Waiting for Clave')
  console.log(stayed && popup ? 'OK  "Open in Clave" opens a new tab; Quill stays on its own page, still waiting' : `FAIL "Open in Clave" took Quill's tab away (popup: ${!!popup}, url: ${page.url()})`)
  if (!(stayed && popup)) code = 1
  const t0 = Date.now()
  await fake.scan(uri) // "scans" the link: answers the connection on the link's relays
  console.log(`pretend Clave answered after ${Date.now() - t0} ms; waiting for the page...`)
  const ok = await page.waitForSelector('.signing-as', { timeout: 30000 }).then(() => true, () => false)
  const text = await page.locator('#app').innerText()
  console.log(ok ? `OK  the page shows: ${(await page.locator('.signing-as').innerText()).replace(/\s+/g, ' ')}` : `FAIL the page never showed "Signing as". It says: ${text.replace(/\s+/g, ' ').slice(0, 300)}`)
  console.log('requests the signer saw:', fake.seen.map((s) => s.method).join(', '))
  console.log('npub it signs as:', nip19.npubEncode(fake.userPk).slice(0, 14) + '…')
  if (!ok) code = 1
  await page.screenshot({ path: '.e2e/sign.png' })
} catch (e) { console.log('FAIL', String(e)); code = 1 } finally {
  if (logs.length) console.log('browser console:\n  ' + logs.slice(0, 8).join('\n  '))
  await fake.stop(); await browser.close()
}
process.exit(code)
