// Starts the real relay binary (RELAY_BIN, e.g. a build of nostr-relay-khatru) on a random port with generous limits, and seeds it.
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import type { Event } from 'nostr-tools'

export const relayBinary = (): string | null => {
  const candidates = [process.env.RELAY_BIN, path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../nostr-relay-khatru/nostr-relay-khatru')].filter(Boolean) as string[]
  return candidates.find((c) => fs.existsSync(c)) ?? null
}

const freePort = () => new Promise<number>((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as net.AddressInfo; s.close(() => resolve(port)) })
})

export interface TestRelay { url: string; stop(): Promise<void>; publish(events: Event[]): Promise<void> }

export async function startRelay(bin: string): Promise<TestRelay> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quill-'))
  const port = await freePort()
  const proc: ChildProcess = spawn(bin, [], {
    env: {
      ...process.env, RELAY_DB_PATH: path.join(dir, 'relay.sqlite'), RELAY_LISTEN_ADDR: `127.0.0.1:${port}`,
      RELAY_EVENTS_PER_MINUTE: '1000000', RELAY_EVENTS_BURST: '1000000', RELAY_REQS_PER_MINUTE: '1000000', RELAY_REQS_BURST: '1000000',
      RELAY_CONNS_PER_MINUTE: '1000000', RELAY_CONNS_BURST: '1000000', RELAY_NAME: 'quill test relay',
    },
    stdio: 'ignore',
  })
  const url = `ws://127.0.0.1:${port}`
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}`, { headers: { Accept: 'application/nostr+json' } })).ok) break } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250))
    if (i === 79) throw new Error('the test relay did not start')
  }
  return {
    url,
    async publish(events) {
      const ws = new WebSocket(url)
      await new Promise<void>((resolve, reject) => { ws.on('open', () => resolve()); ws.on('error', reject) })
      const pending = new Map<string, (ok: boolean) => void>()
      ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m[0] === 'OK') pending.get(m[1])?.(m[2] === true) })
      for (const e of events) {
        const done = new Promise<boolean>((resolve) => pending.set(e.id, resolve))
        ws.send(JSON.stringify(['EVENT', e]))
        if (!(await done)) throw new Error(`the relay rejected a seed event of kind ${e.kind}`)
      }
      ws.close()
    },
    async stop() { proc.kill(); await new Promise((r) => setTimeout(r, 200)); fs.rmSync(dir, { recursive: true, force: true }) },
  }
}
