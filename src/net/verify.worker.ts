// Checks signatures away from the page, so a few hundred of them do not freeze it (and can use another core).
import { verifyEvent, type Event } from 'nostr-tools/pure'

self.onmessage = (m: MessageEvent<{ id: number; events: Event[] }>) => {
  const ok = m.data.events.map((e) => { try { return verifyEvent(e) } catch { return false } })
  ;(self as unknown as { postMessage(x: unknown): void }).postMessage({ id: m.data.id, ok })
}
