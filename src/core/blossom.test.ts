import { describe, expect, it, vi } from 'vitest'
import type { Event } from 'nostr-tools'
import { checkTemplate } from '../sign/policy.js'
import { AUTH_TTL_S, checkImeta, checkUploadAuth, imetaTag, normalizeServer, serversFrom, upload, uploadAuthTemplate, UploadError } from './blossom.js'

const H = 'a'.repeat(64)
const photo = { url: `https://blossom.example/${H}.jpg`, sha256: H, mime: 'image/jpeg', size: 1234, dim: '800x600' }

describe('Blossom photos', () => {
  it('reads the writer\'s server list: https only, tidy, no repeats, at most five', () => {
    const list = { kind: 10063, tags: [['server', 'https://Blossom.Example/'], ['server', 'https://blossom.example'], ['server', 'http://plain.example'], ['server', 'https://x.example/path'], ['r', 'https://no.example']] }
    expect(serversFrom(list)).toEqual(['https://blossom.example'])
    expect(serversFrom({ kind: 1, tags: [['server', 'https://a.example']] })).toEqual([])
    expect(normalizeServer('https://user:pw@a.example')).toBeNull()
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
