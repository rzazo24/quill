// Photos in notes through Blossom: the file goes to one of the WRITER's own Blossom servers (their kind 10063 list, or one they chose here), named by
// its SHA-256, and the note carries its address plus an `imeta` tag (NIP-92) describing it. Quill hosts nothing. Pure parts here: the upload
// authorisation (kind 24242, signed but never published: only the server sees it) and its check, the server list, the imeta tag and the upload itself.
import type { Event } from 'nostr-tools'
import type { Template } from '../sign/policy.js'

export const BLOSSOM_AUTH_KIND = 24242
export const BLOSSOM_SERVERS_KIND = 10063
/** How long an upload authorisation is good for: just the upload in hand. */
export const AUTH_TTL_S = 300
export const MAX_PHOTO_BYTES = 5_000_000
/** Offered when the writer has no list of their own; the choice is theirs, and is kept on this device only. */
export const SUGGESTED_SERVERS = ['https://blossom.primal.net', 'https://blossom.nostr.build'] as const
const HEX64 = /^[0-9a-f]{64}$/

/** A tidy https server address (no path, no trailing slash), or null. */
export function normalizeServer(raw: string): string | null {
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) return null
    return `https://${u.host.toLowerCase()}`
  } catch { return null }
}

/** The servers of a kind 10063 list, in its order, tidy and without repeats. */
export function serversFrom(list: Pick<Event, 'kind' | 'tags'> | null | undefined): string[] {
  if (!list || list.kind !== BLOSSOM_SERVERS_KIND) return []
  const out: string[] = []
  for (const t of list.tags) { const s = t[0] === 'server' && t[1] ? normalizeServer(t[1]) : null; if (s && !out.includes(s)) out.push(s) }
  return out.slice(0, 5)
}

/** BUD-02: "I am uploading the file with this hash", good for a few minutes. */
export function uploadAuthTemplate(sha256: string, nowSec: number): Template {
  return { kind: BLOSSOM_AUTH_KIND, content: 'Upload a photo', tags: [['t', 'upload'], ['x', sha256], ['expiration', String(nowSec + AUTH_TTL_S)]], created_at: nowSec }
}

/** What Quill agrees to sign of kind 24242: an upload of ONE file, by its hash, expiring within minutes. Never a delete, a list or an open-ended one. */
export function checkUploadAuth(t: Template): boolean {
  if (t.kind !== BLOSSOM_AUTH_KIND || t.tags.length !== 3 || t.content.length > 100) return false
  const tag = (n: string) => t.tags.filter((x) => x[0] === n)
  const [tt, x, exp] = [tag('t'), tag('x'), tag('expiration')]
  if (tt.length !== 1 || tt[0]!.length !== 2 || tt[0]![1] !== 'upload') return false
  if (x.length !== 1 || x[0]!.length !== 2 || !HEX64.test(x[0]![1]!)) return false
  if (exp.length !== 1 || exp[0]!.length !== 2 || !/^\d+$/.test(exp[0]![1]!)) return false
  const left = Number(exp[0]![1]) - t.created_at
  return left > 0 && left <= AUTH_TTL_S
}

export interface Photo { url: string; sha256: string; mime: string; size: number; dim?: string }

/** NIP-92: what a client needs to show the photo, and to find it elsewhere by its hash if this server goes away. */
export function imetaTag(p: Photo): string[] {
  return ['imeta', `url ${p.url}`, `m ${p.mime}`, `x ${p.sha256}`, `size ${p.size}`, ...(p.dim ? [`dim ${p.dim}`] : [])]
}

const IMETA_KEYS = new Set(['url', 'm', 'x', 'size', 'dim'])
/** An imeta tag as Quill writes it, for a photo whose address is in the text. */
export function checkImeta(tag: string[], content: string): boolean {
  if (tag[0] !== 'imeta' || tag.length < 5 || tag.length > 6) return false
  const kv = new Map<string, string>()
  for (const entry of tag.slice(1)) {
    const i = entry.indexOf(' ')
    if (i < 1 || entry.length > 300) return false
    const k = entry.slice(0, i), v = entry.slice(i + 1)
    if (!IMETA_KEYS.has(k) || kv.has(k) || !v) return false
    kv.set(k, v)
  }
  const url = kv.get('url') ?? '', x = kv.get('x') ?? ''
  return url.startsWith('https://') && content.includes(url) && HEX64.test(x) && url.includes(x) && /^image\/(jpeg|png|webp|gif)$/.test(kv.get('m') ?? '') && /^\d+$/.test(kv.get('size') ?? '') && (!kv.has('dim') || /^\d+x\d+$/.test(kv.get('dim')!))
}

export class UploadError extends Error {}

/** BUD-02 upload: PUT /upload with the signed authorisation. The server must answer with the same hash: anything else is not our file. */
export async function upload(fetchFn: typeof fetch, server: string, body: Blob, sha256: string, auth: Event): Promise<Photo> {
  const res = await fetchFn(`${server}/upload`, {
    method: 'PUT', body,
    headers: { Authorization: `Nostr ${btoa(JSON.stringify(auth))}`, 'Content-Type': body.type || 'application/octet-stream', 'X-SHA-256': sha256 },
  })
  if (!res.ok) throw new UploadError(res.headers.get('X-Reason') || `${res.status}`)
  let d: { url?: unknown; sha256?: unknown; size?: unknown; type?: unknown }
  try { d = await res.json() as typeof d } catch { throw new UploadError('bad answer') }
  if (d.sha256 !== sha256 || typeof d.url !== 'string' || !d.url.startsWith('https://')) throw new UploadError('the server answered for another file')
  return { url: d.url, sha256, mime: typeof d.type === 'string' && d.type ? d.type : body.type, size: typeof d.size === 'number' ? d.size : body.size }
}

/** The hash a Blossom server names a file by. */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('')
}
