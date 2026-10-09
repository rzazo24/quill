// Makes the screenshots of the README (docs/screenshot.png and docs/screenshot.es.png) with the real, built app (run `npm run build` first) over DEMO data:
// invented accounts with valid signatures, served by a pretend relay inside the browser. Nobody real appears in the pictures.
//   node scripts/screenshots.mjs
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { finalizeEvent, getPublicKey, nip19 } from 'nostr-tools'

const RELAY = 'wss://demo.relay.example'
const key = (name) => new Uint8Array(createHash('sha256').update(`quill-demo:${name}`).digest())
const people = Object.fromEntries(['Lucía', 'Ana', 'Bruno', 'Carla', 'Dani', 'Eva', 'deals_daily', 'giftcards4u', 'free_prizes', 'imgdump'].map((n) => [n, { name: n, sk: key(n), pk: getPublicKey(key(n)) }]))
const now = Math.floor(Date.now() / 1000), ago = (min) => now - min * 60
const sign = (who, kind, content, tags = [], created_at = now) => finalizeEvent({ kind, content, tags, created_at }, people[who].sk)
const npub = (who) => `nostr:${nip19.npubEncode(people[who].pk)}`

// the demo notes, in both languages (the pictures of each README show notes in its own language)
const TEXT = {
  en: { mine: 'Writing up how my little Nostr client explains what it hides.', ana: 'Published the first version of a tiny relay monitor. Text only, about 200 lines.', bruno: 'Quiet morning, strong coffee and a long article. Good day to write something.',
    carla: 'A filter is only useful if it tells you what it hid. Everything else is a guess.', ana2: 'Reading the NIP list again. Some of them are shorter than I remembered.', eva: 'Small thing I like: when an app explains why it hid something, I trust it more.',
    dani: 'Nice write-up, thanks for sharing!', evaMention: 'would you mind a quick question about your relay list?', spam: 'Win a free gift card now, limited offer, click the link below' },
  es: { mine: 'Escribiendo cómo mi pequeño cliente de Nostr explica lo que oculta.', ana: 'Publicada la primera versión de un monitor de relés minúsculo. Solo texto, unas 200 líneas.', bruno: 'Mañana tranquila, café fuerte y un artículo largo. Buen día para escribir algo.',
    carla: 'Un filtro solo sirve si te dice lo que ocultó. Todo lo demás es adivinar.', ana2: 'Releyendo la lista de NIPs. Algunos son más cortos de lo que recordaba.', eva: 'Algo que me gusta: cuando una app explica por qué ocultó algo, me fío más.',
    dani: '¡Buen artículo, gracias por compartirlo!', evaMention: '¿te importaría que te hiciera una pregunta sobre tu lista de relés?', spam: 'Gana una tarjeta regalo gratis ahora, oferta limitada, pulsa el enlace de abajo' },
}
let events = []
const build = (lang) => {
  const T = TEXT[lang]; events = []
  for (const p of Object.values(people)) events.push(sign(p.name, 0, JSON.stringify({ name: p.name }), [], ago(5000)))
  const follows = (who, list) => events.push(sign(who, 3, '', list.map((n) => ['p', people[n].pk]), ago(4000)))
  follows('Lucía', ['Ana', 'Bruno', 'Carla']); follows('Ana', ['Dani', 'Eva']); follows('Bruno', ['Eva']); follows('Carla', [])
  const mine = sign('Lucía', 1, T.mine, [], ago(2 * 24 * 60))
  events.push(mine, sign('Ana', 1, T.ana, [], ago(6)), sign('Bruno', 1, T.bruno, [], ago(22)), sign('Carla', 1, T.carla, [], ago(41)), sign('Ana', 1, T.ana2, [], ago(95)))
  const evaNote = sign('Eva', 1, T.eva, [], ago(130))
  events.push(evaNote, sign('Bruno', 6, JSON.stringify(evaNote), [['e', evaNote.id], ['p', people.Eva.pk]], ago(60)))
  events.push(sign('Dani', 1, T.dani, [['e', mine.id, '', 'root'], ['p', people['Lucía'].pk]], ago(12)))
  events.push(sign('Eva', 1, `${npub('Lucía')} ${T.evaMention}`, [['p', people['Lucía'].pk]], ago(30)))
  for (const [i, who] of ['deals_daily', 'giftcards4u', 'free_prizes'].entries()) events.push(sign(who, 1, T.spam, [['p', people['Lucía'].pk]], ago(8 + i)))
  for (let i = 0; i < 4; i++) events.push(sign('imgdump', 1, `https://img.example/photo-${i}.jpg`, [['p', people['Lucía'].pk]], ago(50 + i)))
}

const matches = (f, e) => (!f.ids || f.ids.includes(e.id)) && (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey)) && (!f.since || e.created_at >= f.since) && (!f.until || e.created_at <= f.until)
  && Object.entries(f).every(([k, v]) => !k.startsWith('#') || e.tags.some((t) => t[0] === k.slice(1) && v.includes(t[1])))
const serve = (ws) => ws.onMessage((raw) => {
  const m = JSON.parse(String(raw)); if (m[0] !== 'REQ') return
  for (const f of m.slice(2)) events.filter((e) => matches(f, e)).sort((a, b) => b.created_at - a.created_at).slice(0, f.limit ?? 500).forEach((e) => ws.send(JSON.stringify(['EVENT', m[1], e])))
  ws.send(JSON.stringify(['EOSE', m[1]]))
})

const PORT = 4174
const srv = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 250)) }
const browser = await chromium.launch()
const shots = async (lang) => {
  const out = []
  for (const hash of ['#/', '#/mentions', '#/settings/filter']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const p = await ctx.newPage()
    await p.routeWebSocket(`${RELAY}/`, serve)
    await p.addInitScript(({ me, lang, relay }) => { localStorage.setItem('me', me); localStorage.setItem('lang', lang); localStorage.setItem('relays', JSON.stringify([relay])); localStorage.setItem('avatars', 'robots') }, { me: people['Lucía'].pk, lang, relay: RELAY })
    await p.goto(`http://localhost:${PORT}/${hash}`, { waitUntil: 'domcontentloaded' })
    await p.waitForSelector(hash === '#/settings/filter' ? '.settings' : 'article.note', { timeout: 20000, state: 'attached' }); await new Promise((r) => setTimeout(r, 2200))
    out.push((await p.screenshot({ type: 'png' })).toString('base64')); await ctx.close()
  }
  return out
}
for (const [lang, file] of [['en', 'docs/screenshot.png'], ['es', 'docs/screenshot.es.png']]) {
  build(lang); const imgs = await shots(lang)
  const page = await (await browser.newContext({ viewport: { width: 1290, height: 810 }, deviceScaleFactor: 2 })).newPage()
  await page.setContent(`<!doctype html><body style="margin:0;background:#0b0f16;display:flex;gap:30px;justify-content:center;align-items:center;height:100vh">${imgs.map((b) => `<img src="data:image/png;base64,${b}" width="390" style="border-radius:22px;border:1px solid #1f2a3a;display:block">`).join('')}</body>`)
  await new Promise((r) => setTimeout(r, 300)); await page.screenshot({ path: file, type: 'png' }); console.log('wrote', file)
}
await browser.close(); srv.kill()
