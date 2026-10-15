// Dev tool: who has published with Quill lately. Notes and reactions made with Quill carry the NIP-89 tag ["client", "Quill"] (a setting, on by
// default); relays cannot filter by it (only single-letter tags), so this reads every note and reaction of the window, page by page, and counts the
// tagged ones by account. Reads only. Usage:
//   node scripts/who-uses-quill.mjs [days=7]
// Big relays stop answering after a few thousand events: a window of many days on them is a sample, not a census (it says so per relay).
import WebSocket from 'ws'

const days = Number(process.argv[2] ?? 7)
if (!(days > 0)) { console.error('usage: node scripts/who-uses-quill.mjs [days]'); process.exit(1) }
const since = Math.floor(Date.now() / 1000) - Math.round(days * 86400)
const RELAYS = ['wss://relay.hivescope.xyz', 'wss://relay.primal.net', 'wss://nos.lol', 'wss://nostr.mom', 'wss://nostr.oxtr.dev', 'wss://nostr.bitcoiner.social']
const PAGE = 500, MAX_PAGES = 40 // up to 20 000 events per relay

/** One page of notes and reactions, newest first, up to `until`. */
const page = (url, until) => new Promise((resolve) => {
  const out = []
  let ws
  const done = () => { try { ws.close() } catch { /* already closed */ } resolve(out) }
  const timer = setTimeout(done, 15000)
  ws = new WebSocket(url)
  ws.on('error', () => { clearTimeout(timer); done() })
  ws.on('open', () => ws.send(JSON.stringify(['REQ', 'q', { kinds: [1, 7], since, ...(until !== undefined ? { until } : {}), limit: PAGE }])))
  ws.on('message', (m) => { const d = JSON.parse(m); if (d[0] === 'EVENT') out.push(d[2]); else if (d[0] === 'EOSE' || d[0] === 'CLOSED') { clearTimeout(timer); done() } })
})

const tagged = new Map()
const perRelay = await Promise.all(RELAYS.map(async (url) => {
  let until, read = 0, reached = false, last = PAGE
  for (let i = 0; i < MAX_PAGES; i++) {
    const events = await page(url, until)
    if (!events.length) { reached = read === 0 || last < PAGE; break } // empty after a short page: nothing older there; after full pages: the relay stopped answering
    read += events.length; last = events.length
    for (const e of events) if (e.tags.some((t) => t[0] === 'client' && t[1] === 'Quill')) tagged.set(e.id, e)
    const oldest = Math.min(...events.map((e) => e.created_at))
    if (oldest <= since) { reached = true; break }
    if (until !== undefined && oldest >= until) break // the relay keeps sending the same page: it will not go further back
    until = oldest - 1
  }
  return { url, read, reached }
}))

for (const r of perRelay) console.log(`${r.url.padEnd(32)} ${String(r.read).padStart(7)} read${r.reached ? '' : '  (stopped before the start of the window: a sample)'}`)
const accounts = new Map()
for (const e of tagged.values()) {
  const a = accounts.get(e.pubkey) ?? { notes: 0, reactions: 0, first: Infinity, last: 0 }
  if (e.kind === 1) a.notes++; else a.reactions++
  a.first = Math.min(a.first, e.created_at); a.last = Math.max(a.last, e.created_at)
  accounts.set(e.pubkey, a)
}
console.log(`\n${tagged.size} events made with Quill in the last ${days} day(s), from ${accounts.size} account(s)`)
const day = (s) => new Date(s * 1000).toISOString().slice(0, 16).replace('T', ' ')
for (const [pk, a] of [...accounts].sort((x, y) => y[1].notes + y[1].reactions - (x[1].notes + x[1].reactions))) console.log(`${pk}  ${a.notes} notes, ${a.reactions} reactions  (${day(a.first)} → ${day(a.last)} UTC)`)
