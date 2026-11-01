// Many signatures at once. In the browser they are checked by a few workers in parallel; where there are no workers (tests), right here.
import { verifiedSymbol, verifyEvent, type Event } from 'nostr-tools/pure'

export type VerifyMany = (events: Event[]) => Promise<boolean[]>

export const verifyHere: VerifyMany = async (events) => events.map((e) => verifyEvent(e))

const BATCH = 48

/** A batch a worker has not answered in this long is checked here instead: a worker that died (an error, a phone that suspended it) must not leave
 *  a page waiting forever ("Mentions stays loading"). */
export const WORKER_WAIT_MS = 10_000
export function workerVerifier(make: () => Worker, count: number, waitMs = WORKER_WAIT_MS): VerifyMany {
  const workers = Array.from({ length: Math.max(1, count) }, make)
  const waiting = new Map<number, (ok: boolean[]) => void>()
  let next = 0, turn = 0
  for (const w of workers) {
    w.onmessage = (m: MessageEvent<{ id: number; ok: boolean[] }>) => { waiting.get(m.data.id)?.(m.data.ok); waiting.delete(m.data.id) }
    w.onerror = () => { for (const [id, done] of [...waiting]) { waiting.delete(id); done(null as unknown as boolean[]) } } // checked here, below
  }
  const one = (events: Event[]) => new Promise<boolean[]>((resolve) => {
    const id = next++
    const timer = setTimeout(() => { if (waiting.delete(id)) resolve(events.map((e) => verifyEvent(e))) }, waitMs)
    waiting.set(id, (ok) => { clearTimeout(timer); resolve(Array.isArray(ok) && ok.length === events.length ? ok : events.map((e) => verifyEvent(e))) })
    try { workers[turn++ % workers.length]!.postMessage({ id, events: events.map(({ id: i, pubkey, created_at, kind, tags, content, sig }) => ({ id: i, pubkey, created_at, kind, tags, content, sig })) }) }
    catch { if (waiting.delete(id)) { clearTimeout(timer); resolve(events.map((e) => verifyEvent(e))) } }
  })
  return async (events) => {
    const parts: Promise<boolean[]>[] = []
    for (let i = 0; i < events.length; i += BATCH) parts.push(one(events.slice(i, i + BATCH)))
    const ok = (await Promise.all(parts)).flat()
    events.forEach((e, i) => { if (ok[i]) (e as Event & { [verifiedSymbol]?: boolean })[verifiedSymbol] = true }) // later checks of the same event are instant
    return ok
  }
}
