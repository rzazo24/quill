import { describe, expect, it, vi } from 'vitest'
import type { Event } from 'nostr-tools'
import { checkTemplate } from '../sign/policy.js'
import { AUTH_TTL_S, checkServerList, hashFromUrl, photoCandidates, serverListTemplate, checkImeta, checkUploadAuth, imetaTag, normalizeServer, serversFrom, upload, uploadAuthTemplate, UploadError } from './blossom.js'

const H = 'a'.repeat(64)
const photo = { url: `https://blossom.example/${H}.jpg`, sha256: H, mime: 'image/jpeg', size: 1234, dim: '800x600' }

describe('Blossom photos', () => {
  it('reads the writer\'s server list: https only, tidy, no repeats, at most five', () => {
    const list = { kind: 10063, tags: [['server', 'https://Blossom.Example/'], ['server', 'https://blossom.example'], ['server', 'http://plain.example'], ['server', 'https://x.example/path'], ['r', 'https://no.example']] }
    expect(serversFrom(list)).toEqual(['https://blossom.example'])
    expect(serversFrom({ kind: 1, tags: [['server', 'https://a.example']] })).toEqual([])
    expect(normalizeServer('https://user:pw@a.example')).toBeNull()
  })
  it('publishes the writer\'s server list with server addresses only', () => {
    const t = serverListTemplate(['https://blossom.band'], 1)
    expect(checkServerList(t)).toBe(true); expect(checkTemplate(t)).toBeNull()
    expect(checkTemplate({ ...t, tags: [['server', 'http://plain.example']] })).toBe('server-list')
    expect(checkTemplate({ ...t, tags: [['server', 'https://a.example'], ['r', 'wss://x.example']] })).toBe('server-list')
    expect(checkTemplate({ ...t, tags: [] })).toBe('server-list')
  })
  it('signs only an upload of one file, by its hash, for a few minutes', () => {
    const t = uploadAuthTemplate(H, 1000)
    expect(checkUploadAuth(t)).toBe(true); expect(checkTemplate(t)).toBeNull()
    expect(checkTemplate({ ...t, tags: [['t', 'delete'], ['x', H], ['expiration', '1100']] })).toBe('upload')
    expect(checkTemplate({ ...t, tags: [['t', 'upload'], ['expiration', '1100']] })).toBe('upload')
    expect(checkTemplate({ ...t, tags: [['t', 'upload'], ['x', H], ['expiration', String(1000 + AUTH_TTL_S + 1)]] })).toBe('upload') // open-ended: no
  })
  it('a note may carry the imeta of a photo whose address is in its text, and nothing that pretends to be one', () => {
    const tag = imetaTag(photo)
    expect(checkImeta(tag, `look ${photo.url}`)).toBe(true)
    expect(checkTemplate({ kind: 1, content: `look ${photo.url}`, tags: [tag], created_at: 1 })).toBeNull()
    expect(checkTemplate({ kind: 1, content: 'no address here', tags: [tag], created_at: 1 })).toBe('tags')
    expect(checkTemplate({ kind: 7, content: '+', tags: [['e', H], ['p', H], tag], created_at: 1 })).toBe('tags')
    expect(checkImeta(['imeta', `url ${photo.url}`, 'm text/html', `x ${H}`, 'size 1'], photo.url)).toBe(false)
    expect(checkImeta(['imeta', 'url https://evil.example/other.jpg', 'm image/jpeg', `x ${H}`, 'size 1'], 'https://evil.example/other.jpg')).toBe(false) // the address must be the file's
  })
  it('uploads with the signed permission and only accepts an answer about the same file', async () => {
    const auth = { id: 'i', kind: 24242 } as unknown as Event
    const ok = vi.fn(async () => new Response(JSON.stringify({ url: photo.url, sha256: H, size: 1234, type: 'image/jpeg' })))
    const got = await upload(ok as unknown as typeof fetch, 'https://blossom.example', new Blob(['x'], { type: 'image/jpeg' }), H, auth)
    expect(got).toMatchObject({ url: photo.url, sha256: H, size: 1234 })
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://blossom.example/upload'); expect(init.method).toBe('PUT')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Nostr ${btoa(JSON.stringify(auth))}`)
    const other = vi.fn(async () => new Response(JSON.stringify({ url: photo.url, sha256: 'b'.repeat(64) })))
    await expect(upload(other as unknown as typeof fetch, 'https://blossom.example', new Blob(['x']), H, auth)).rejects.toBeInstanceOf(UploadError)
    const refused = vi.fn(async () => new Response('', { status: 402, headers: { 'X-Reason': 'payment required' } }))
    await expect(upload(refused as unknown as typeof fetch, 'https://blossom.example', new Blob(['x']), H, auth)).rejects.toThrow('payment required')
  })
})

describe('finding a photo again by its hash', () => {
  const A = 'b1674191a88ec5cdd733e4240a81803105dc412d6c6708d53ab94fc248f4f553', U = 'ec4425ff5e9446080d2f70440188e3ca5d6da8713db7bdeef73d0ed54d9093f0'
  it('the hash is the last 64-hex string in the path (BUD-03 examples, two hashes included)', () => {
    expect(hashFromUrl(`https://cdn.example.com/${A}.pdf`)).toBe(A)
    expect(hashFromUrl(`https://cdn.example.com/user/${U}/media/${A}.pdf`)).toBe(A)
    expect(hashFromUrl(`https://cdn.example.com/${A}`)).toBe(A)
    expect(hashFromUrl('https://image.example/cat.jpg')).toBeNull()
  })
  it('candidates: the imeta fallbacks of that address first, then the author’s servers by hash with the extension; each once, never the failed host, at most five', () => {
    const url = `https://dead.example/${A}.jpg`
    const tags = [['imeta', `url ${url}`, `x ${A}`, `fallback https://b.example/${A}.jpg`, `fallback https://dead.example/${A}.png`, 'fallback http://plain.example/x.jpg', 'colour red']]
    const servers = ['https://b.example', 'https://C.example/', 'https://dead.example', 'ftp://no.example', 'https://d.example', 'https://e.example', 'https://f.example']
    expect(photoCandidates(url, tags, servers)).toEqual([`https://b.example/${A}.jpg`, `https://c.example/${A}.jpg`, `https://d.example/${A}.jpg`, `https://e.example/${A}.jpg`, `https://f.example/${A}.jpg`])
  })
  it('an imeta of another address is ignored; a fallback that is not https is dropped; a claimed hash that differs means nothing to look for', () => {
    const url = `https://dead.example/${A}.jpg`
    expect(photoCandidates(url, [['imeta', `url https://other.example/${A}.jpg`, `fallback https://b.example/${A}.jpg`]], [])).toEqual([])
    expect(photoCandidates(url, [['imeta', `url ${url}`, 'fallback http://b.example/x.jpg']], [])).toEqual([])
    expect(photoCandidates(url, [['imeta', `url ${url}`, `x ${U}`, `fallback https://b.example/${A}.jpg`]], ['https://c.example'])).toBeNull()
  })
  it('without a hash there is nothing to look for', () => {
    expect(photoCandidates('https://image.example/cat.jpg', [], ['https://c.example'])).toBeNull()
  })
  it('Quill’s own imeta may carry up to two fallbacks with the same hash', () => {
    const p = { url: `https://a.example/${H}.jpg`, sha256: H, mime: 'image/jpeg', size: 10, fallbacks: [`https://b.example/${H}.jpg`] }
    const tag = imetaTag(p)
    expect(tag).toContain(`fallback https://b.example/${H}.jpg`)
    expect(checkImeta(tag, p.url)).toBe(true)
    expect(checkImeta([...imetaTag({ ...p, fallbacks: [] }), 'fallback https://evil.example/other.jpg'], p.url)).toBe(false)
  })
})
