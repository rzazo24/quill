// The relays the reader chooses: what is accepted, what is stored, and a "does it answer?" check. A relay address typed by hand is untrusted input.
export const MIN_RELAYS = 1
export const MAX_RELAYS = 10

/** `relay.example.com`, `wss://relay.example.com/` and `WSS://Relay.Example.com` all become `wss://relay.example.com`. Anything that is not a plain secure relay address is refused (null):
 *  ws:// (unencrypted), other schemes, credentials, query or fragment, names without a dot (localhost, intranet) and IP addresses. */
export function normalizeRelay(input: string): string | null {
  let s = input.trim()
  if (!s || s.length > 200 || /\s/.test(s)) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `wss://${s}`
  let u: URL
  try { u = new URL(s) } catch { return null }
  if (u.protocol !== 'wss:' || u.username || u.password || u.search || u.hash) return null
  const host = u.hostname.toLowerCase()
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host) || /^[0-9.]+$/.test(host)) return null // a name with a dot; not an IP address
  const path = u.pathname.replace(/\/+$/, '')
  return `wss://${host}${u.port ? `:${u.port}` : ''}${path}`
}

/** What is stored: a JSON list. Anything wrong with it and the default list is used (null); entries that are not valid are dropped. */
export function parseRelays(raw: string | null): string[] | null {
  try {
    const list = JSON.parse(raw ?? 'null') as unknown
    if (!Array.isArray(list)) return null
    const ok = [...new Set(list.map((x) => (typeof x === 'string' ? normalizeRelay(x) : null)).filter((x): x is string => !!x))].slice(0, MAX_RELAYS)
    return ok.length >= MIN_RELAYS ? ok : null
  } catch { return null }
}

export type AddResult = { ok: true; list: string[] } | { ok: false; why: 'invalid' | 'duplicate' | 'full' }
export function addRelay(list: string[], input: string): AddResult {
  const url = normalizeRelay(input)
  if (!url) return { ok: false, why: 'invalid' }
  if (list.includes(url)) return { ok: false, why: 'duplicate' }
  if (list.length >= MAX_RELAYS) return { ok: false, why: 'full' }
  return { ok: true, list: [...list, url] }
}
/** The last relay cannot be removed: with none, nothing could be read. */
export const removeRelay = (list: string[], url: string): string[] => (list.length <= MIN_RELAYS ? list : list.filter((x) => x !== url))

/** Does something answer on that address? It only opens the connection and closes it: nothing is sent. */
export function probeRelay(url: string, timeoutMs = 5000, WS: typeof WebSocket = WebSocket): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false, ws: WebSocket | undefined
    const finish = (ok: boolean) => { if (done) return; done = true; clearTimeout(timer); try { ws?.close() } catch { /* already closed */ } resolve(ok) }
    const timer = setTimeout(() => finish(false), timeoutMs)
    try { ws = new WS(url); ws.onopen = () => finish(true); ws.onerror = () => finish(false); ws.onclose = () => finish(false) } catch { finish(false) }
  })
}
