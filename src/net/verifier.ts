// Many signatures at once. In the browser they are checked by a few workers in parallel; where there are no workers (tests), right here.
import { verifiedSymbol, verifyEvent, type Event } from 'nostr-tools/pure'

export type VerifyMany = (events: Event[]) => Promise<boolean[]>

export const verifyHere: VerifyMany = async (events) => events.map((e) => verifyEvent(e))

const BATCH = 48

export function workerVerifier(make: () => Worker, count: number): VerifyMany {
  const workers = Array.from({ length: Math.max(1, count) }, make)
  const waiting = new Map<number, (ok: boolean[]) => void>()
  let next = 0, turn = 0
  for (const w of workers) w.onmessage = (m: MessageEvent<{ id: number; ok: boolean[] }>) => { waiting.get(m.data.id)?.(m.data.ok); waiting.delete(m.data.id) }
  const one = (events: Event[]) => new Promise<boolean[]>((resolve) => {
    const id = next++; waiting.set(id, resolve)
    workers[turn++ % workers.length]!.postMessage({ id, events: events.map(({ id: i, pubkey, created_at, kind, tags, content, sig }) => ({ id: i, pubkey, created_at, kind, tags, content, sig })) })
  })
  return async (events) => {
    const parts: Promise<boolean[]>[] = []
    for (let i = 0; i < events.length; i += BATCH) parts.push(one(events.slice(i, i + BATCH)))
    const ok = (await Promise.all(parts)).flat()
    events.forEach((e, i) => { if (ok[i]) (e as Event & { [verifiedSymbol]?: boolean })[verifiedSymbol] = true }) // later checks of the same event are instant
    return ok
  }
}
