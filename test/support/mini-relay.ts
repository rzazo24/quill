// A tiny in-memory relay for tests that STORES every event it is given, kind 24133 included, like relay.powr.build does (the khatru test relay treats
// that kind as ephemeral). It lets a test publish an answer while the client is "asleep" and check that the client finds it afterwards.
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Event, Filter } from 'nostr-tools'
import { answers } from '../../src/net/fetcher.js'

export interface MiniRelay {
  url: string
  stored: Event[]
  /** Cuts the open connections (a phone suspending the page), except those made on `exceptPath` (the signer's). The relay keeps its events. */
  dropConnections(exceptPath?: string): void
  /** How many REQ messages have been received (to see that a client really asked again). */
  reqs: number
  stop(): Promise<void>
}

const matches = (f: Filter, e: Event): boolean => answers(f, e) && (f.since === undefined || e.created_at >= f.since) && (f.until === undefined || e.created_at <= f.until)

export async function startMiniRelay(): Promise<MiniRelay> {
  const http = createServer()
  const wss = new WebSocketServer({ server: http })
  const stored: Event[] = []
  const subs = new Map<WebSocket, Map<string, Filter[]>>()
  const relay: MiniRelay = { url: '', stored, reqs: 0, dropConnections(exceptPath) { for (const ws of wss.clients) if (exceptPath === undefined || (ws as WebSocket & { path?: string }).path !== exceptPath) ws.terminate() }, stop: async () => { for (const ws of wss.clients) ws.terminate(); await new Promise<void>((r) => wss.close(() => http.close(() => r()))) } }
  wss.on('connection', (ws, req) => {
    ;(ws as WebSocket & { path?: string }).path = req.url
    subs.set(ws, new Map())
    ws.on('close', () => subs.delete(ws))
    ws.on('message', (raw) => {
      let m: unknown[]
      try { m = JSON.parse(String(raw)) } catch { return }
      if (m[0] === 'EVENT') {
        const e = m[1] as Event
        if (!stored.some((s) => s.id === e.id)) stored.push(e)
        ws.send(JSON.stringify(['OK', e.id, true, '']))
        for (const [sock, bySub] of subs) for (const [id, filters] of bySub) if (filters.some((f) => matches(f, e)) && sock.readyState === 1) sock.send(JSON.stringify(['EVENT', id, e]))
      } else if (m[0] === 'REQ') {
        relay.reqs++
        const id = m[1] as string, filters = m.slice(2) as Filter[]
        subs.get(ws)?.set(id, filters)
        for (const e of stored) if (filters.some((f) => matches(f, e))) ws.send(JSON.stringify(['EVENT', id, e]))
        ws.send(JSON.stringify(['EOSE', id]))
      } else if (m[0] === 'CLOSE') subs.get(ws)?.delete(m[1] as string)
    })
  })
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', () => r()))
  relay.url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}`
  return relay
}
