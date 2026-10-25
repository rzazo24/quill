import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { Signer, type Nip07 } from './signer.js'
import type { Template } from './policy.js'

const mem = () => { const m = new Map<string, string>(); return { m, kv: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } } }
const note = (text: string): Template => ({ kind: 1, content: text, tags: [], created_at: Math.floor(Date.now() / 1000) })

/** A pretend extension: signs with its own key, or misbehaves on request. */
function extension(opts: { other?: boolean; tamper?: boolean } = {}) {
  const sk = generateSecretKey(), otherSk = generateSecretKey(), asked: Template[] = []
  const x: Nip07 = {
    getPublicKey: async () => getPublicKey(sk),
    signEvent: async (t) => { asked.push(t); return finalizeEvent({ ...t, content: opts.tamper ? t.content + '!' : t.content }, opts.other ? otherSk : sk) },
  }
  return { x, pk: getPublicKey(sk), asked }
}

describe('signing with a browser extension (NIP-07)', () => {
  it('connects, signs through the extension, and checks what comes back', async () => {
    const e = extension(), s = mem()
    const signer = new Signer({ kv: s.kv, extension: () => e.x })
    expect(signer.hasExtension()).toBe(true)
    expect(await signer.connectExtension()).toBe(true)
    expect(signer.state).toBe('connected'); expect(signer.pubkey).toBe(e.pk)
    const { event } = await signer.sign(note('hello from an extension'), 5000)
    expect(event.pubkey).toBe(e.pk); expect(e.asked).toHaveLength(1)
    expect(await signer.ping(100)).toBe(true)
  })
  it('the same policy applies: what Quill would not sign is never sent to the extension', async () => {
    const e = extension(), signer = new Signer({ kv: mem().kv, extension: () => e.x })
    await signer.connectExtension()
    await expect(signer.sign({ kind: 4, content: 'x', tags: [], created_at: 1 }, 5000)).rejects.toThrow(/will not sign/)
    expect(e.asked).toHaveLength(0)
  })
  it('an extension that signs as another key, or changes the note, is refused and nothing is returned', async () => {
    const other = extension({ other: true }), a = new Signer({ kv: mem().kv, extension: () => other.x })
    await a.connectExtension(); await expect(a.sign(note('x'), 5000)).rejects.toThrow(/differs/)
    const tamper = extension({ tamper: true }), b = new Signer({ kv: mem().kv, extension: () => tamper.x })
    await b.connectExtension(); await expect(b.sign(note('x'), 5000)).rejects.toThrow(/differs/)
  })
  it('comes back after a reload without asking anything; Disconnect forgets it', async () => {
    const e = extension(), s = mem()
    await new Signer({ kv: s.kv, extension: () => e.x }).connectExtension()
    const again = new Signer({ kv: s.kv, extension: () => e.x })
    expect(again.hasSavedSession()).toBe(true)
    expect(await again.resume()).toBe(true); expect(again.pubkey).toBe(e.pk)
    await again.disconnect()
    expect(s.m.has('signerExt')).toBe(false); expect(new Signer({ kv: s.kv, extension: () => e.x }).hasSavedSession()).toBe(false)
  })
  it('without an extension there is nothing to offer, and connecting says so', async () => {
    const signer = new Signer({ kv: mem().kv, extension: () => undefined })
    expect(signer.hasExtension()).toBe(false)
    expect(await signer.connectExtension()).toBe(false); expect(signer.lastError).toMatch(/no browser extension/)
  })
})
