import { describe, expect, it } from 'vitest'
import { ev, pk } from '../core/testutil.js'
import { answers, type Fetcher } from '../net/fetcher.js'
import { checkTemplate } from '../sign/policy.js'
import { listState, loadPublishedRelays, relayListTemplate } from './relaylist.js'

const me = pk('1'), other = pk('2')
const list = (who: string, urls: string[], at: number, extra: string[][] = []) => ev(who, '', { kind: 10002, created_at: at, tags: [...urls.map((u) => ['r', u]), ...extra] })
const world = (events: ReturnType<typeof ev>[]): Fetcher => ({ query: async (f) => events.filter((e) => answers(f, e)) })

describe('reading the published list', () => {
  it('takes the newest list of the reader, tidies the addresses, ignores markers and invalid entries', async () => {
    const f = world([list(me, ['wss://old.example.com'], 100), list(me, ['wss://New.Example.com/', 'wss://b.example.com', 'ws://insecure.example.com', 'nonsense'], 200, [['r', 'wss://c.example.com', 'read'], ['p', 'x']]), list(other, ['wss://other.example.com'], 300)])
    expect(await loadPublishedRelays(f, me)).toEqual(['wss://new.example.com', 'wss://b.example.com', 'wss://c.example.com'])
  })
  it('even a relay that ignores the filter and returns other people\'s lists cannot make one the reader\'s', async () => {
    const hostile: Fetcher = { query: async () => [list(other, ['wss://evil.example.com'], 999)] }
    expect(await loadPublishedRelays(hostile, me)).toBeNull()
  })
  it('null when there is none or nothing in it is usable', async () => {
    expect(await loadPublishedRelays(world([]), me)).toBeNull(); expect(await loadPublishedRelays(world([list(me, ['ws://x.example.com'], 1)]), me)).toBeNull(); expect(await loadPublishedRelays(world([list(other, ['wss://a.example.com'], 1)]), me)).toBeNull()
  })
  it('compares lists as sets', () => {
    expect(listState(undefined, ['wss://a.example.com'])).toBe('unknown'); expect(listState(null, ['wss://a.example.com'])).toBe('none')
    expect(listState(['wss://a.example.com', 'wss://b.example.com'], ['wss://b.example.com', 'wss://a.example.com'])).toBe('same'); expect(listState(['wss://a.example.com'], ['wss://a.example.com', 'wss://b.example.com'])).toBe('differs')
  })
})

describe('the policy for signing a relay list', () => {
  const t = (tags: string[][], content = '', kind = 10002) => ({ kind, content, tags, created_at: 1 })
  it('accepts exactly what Quill builds', () => { expect(checkTemplate(relayListTemplate(['wss://a.example.com', 'wss://b.example.com:8443/x'], 5))).toBeNull() })
  it('refuses anything else: content, other tags, markers, repeats, untidy or insecure addresses, none, too many', () => {
    const bad = [t([['r', 'wss://a.example.com']], 'hello'), t([['r', 'wss://a.example.com'], ['p', me]]), t([['r', 'wss://a.example.com', 'read']]), t([['r', 'wss://a.example.com'], ['r', 'wss://a.example.com']]),
      t([['r', 'wss://A.example.com']]), t([['r', 'wss://a.example.com/']]), t([['r', 'ws://a.example.com']]), t([['r', 'wss://127.0.0.1']]), t([]), t(Array.from({ length: 11 }, (_, i) => ['r', `wss://r${i}.example.com`])), t([['r']])]
    for (const x of bad) expect(checkTemplate(x), JSON.stringify(x)).toBe('relay-list')
  })
  it('other kinds are still refused', () => { for (const k of [0, 3, 5, 30023]) expect(checkTemplate(t([['r', 'wss://a.example.com']], '', k)), String(k)).toBe('kind') })
})
