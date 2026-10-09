// Dev tool: runs the data layer against real relays for one npub and prints what the filter would do. Reads only. Usage:
//   npm run probe -- <npub|hex>
import { nip19 } from 'nostr-tools'
import { useWebSocketImplementation } from 'nostr-tools/pool'
import WebSocket from 'ws'
import { loadFollowing, loadMentions, loadNames } from '../src/data/feed.js'
import { contextOf, loadSession } from '../src/data/session.js'
import { tally } from '../src/core/verdict.js'
import { poolFetcher } from '../src/net/fetcher.js'

useWebSocketImplementation(WebSocket)
const arg = process.argv[2] ?? ''
const me = arg.startsWith('npub') ? (nip19.decode(arg).data as string) : arg
const f = poolFetcher()
const t0 = Date.now(), lap = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`)

const s = await loadSession(f, me)
lap(`follows ${s.follows.size}, muted ${s.muted.size} keys + ${s.mutedWords.length} words, graph lists ${s.graphInfo.answered}/${s.graphInfo.total} loaded=${s.graphInfo.graph.loaded}`)
const ctx = contextOf(s)
const feed = await loadFollowing(f, ctx)
lap(`following feed: ${feed.length} notes`, ), console.log(' ', JSON.stringify(tally(feed)))
const men = await loadMentions(f, ctx)
lap(`mentions: ${men.length} notes`), console.log(' ', JSON.stringify(tally(men)))
const names = await loadNames(f, men.map((x) => x.event.pubkey))
for (const { event, verdict } of men.slice(0, 40)) {
  const who = names.get(event.pubkey) ?? event.pubkey.slice(0, 8)
  console.log(`  ${verdict.hidden ? 'HIDDEN' : 'shown '} ${verdict.rule.padEnd(15)} ${JSON.stringify(verdict.params).padEnd(28)} ${who.slice(0, 18).padEnd(18)} ${event.content.replace(/\s+/g, ' ').slice(0, 60)}`)
}
process.exit(0)
