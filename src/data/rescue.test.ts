import type { Event, Filter } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import { ev, pk } from '../core/testutil.js'
import { answers, type Fetcher } from '../net/fetcher.js'
import type { Publisher } from '../net/publisher.js'
import { backupFile, collectBackup, copyNotes, coverage, scanNotes } from './rescue.js'

const me = pk('a'), other = pk('b')
const A = 'wss://a.example', B = 'wss://b.example', C = 'wss://c.example'

/** Each relay holds its own events; `cap`: the most it returns per question (like a real relay), `down`: relays that fail. */
function relays(held: Record<string, Event[]>, { cap = 1000, down = [] as string[] } = {}): Fetcher & { asked: Filter[] } {
  const asked: Filter[] = []
  return {
    asked,
    query: async (f, o) => {
      asked.push(f)
      if ((f.kinds?.length ?? 0) > 10) return [] // like khatru's sqlite store: too many kinds, nothing
      const url = o?.only?.[0] ?? ''
      if (down.includes(url)) throw new Error('down')
      return (held[url] ?? []).filter((e) => answers(f, e) && (f.until === undefined || e.created_at <= f.until) && (f.since === undefined || e.created_at >= f.since)).sort((a, b) => b.created_at - a.created_at).slice(0, Math.min(f.limit ?? cap, cap))
    },
  }
}

describe('your notes, safe', () => {
  const n1 = ev(me, 'everywhere'), n2 = ev(me, 'only on A'), n3 = ev(me, 'on B and C'), stranger = ev(other, 'not mine')
  const art = ev(me, '# long', { kind: 30023, tags: [['d', 'x']] })

  it('says where each note is: how many are on one relay only, and what each of your relays lacks', async () => {
    const f = relays({ [A]: [n1, n2, art, stranger], [B]: [n1, n3, art], [C]: [n1, n3] })
    const scan = await scanNotes(f, me, [A, B, C])
    expect(scan.perRelay).toEqual([{ relay: A, count: 3, failed: false }, { relay: B, count: 3, failed: false }, { relay: C, count: 2, failed: false }])
    const cov = coverage(scan, [A, B]) // C is only on the published list: it is looked at, never copied to
    expect(cov).toMatchObject({ total: 4, single: 1, missing: 2 })
    expect(cov.lacking.get(A)!.map((e) => e.id)).toEqual([n3.id]); expect(cov.lacking.get(B)!.map((e) => e.id)).toEqual([n2.id]); expect(cov.lacking.has(C)).toBe(false)
  })

  it('a note you deleted is neither counted nor copied back, even if some relay still keeps it', async () => {
    const gone = ev(me, 'deleted'), deletion = ev(me, '', { kind: 5, tags: [['e', gone.id]] })
    const scan = await scanNotes(relays({ [A]: [n1, gone], [B]: [n1, deletion] }), me, [A, B])
    expect([...scan.notes.keys()]).toEqual([n1.id]); expect(scan.perRelay.map((r) => r.count)).toEqual([1, 1])
    expect(coverage(scan, [A, B]).missing).toBe(0)
  })

  it('reads a relay page by page when it returns fewer than asked, and a relay that fails is said and never copied to', async () => {
    const many = Array.from({ length: 700 }, (_, i) => ev(me, `note ${i}`))
    const f = relays({ [A]: many, [B]: many.slice(0, 10) }, { cap: 300, down: [C] })
    const scan = await scanNotes(f, me, [A, B, C])
    expect(scan.perRelay).toEqual([{ relay: A, count: 700, failed: false }, { relay: B, count: 10, failed: false }, { relay: C, count: 0, failed: true }])
    const cov = coverage(scan, [A, B, C])
    expect(cov.lacking.get(B)!.length).toBe(690); expect(cov.lacking.has(C)).toBe(false)
  })

  it('copies each relay what it lacks, oldest first, the notes exactly as signed; a relay that refuses three in a row is left alone', async () => {
    const sent: [string, string][] = []
    const p: Publisher = { publish: async (e, rs) => { const r = rs![0]!; sent.push([r, e.id]); return { [r]: r === B ? 'blocked: not allowed' : r === C && e.id === n2.id ? 'duplicate: already have it' : 'ok' } } }
    const lacking = new Map([[A, [n3, n1]], [B, [n1, n2, n3, art]], [C, [n2]]])
    const progress: number[] = []
    const out = await copyNotes(p, lacking, (d) => progress.push(d), 0)
    expect(out).toEqual([{ relay: A, sent: 2, ok: 2, failed: 0 }, { relay: B, sent: 3, ok: 0, failed: 3, reason: 'blocked: not allowed' }, { relay: C, sent: 1, ok: 1, failed: 0 }])
    expect(sent.filter(([r]) => r === A).map(([, id]) => id)).toEqual([n3.id, n1.id])
    expect(progress.at(-1)).toBe(7) // the note never sent to B still counts as done
  })

  it('the file: everything published, from every relay, the newest of each list only, deleted notes left out', async () => {
    const oldProfile = ev(me, '{"name":"old"}', { kind: 0, created_at: 100 }), newProfile = ev(me, '{"name":"new"}', { kind: 0, created_at: 200 })
    const gone = ev(me, 'deleted'), deletion = ev(me, '', { kind: 5, tags: [['e', gone.id]] })
    const artOld = ev(me, 'v1', { kind: 30023, created_at: 100, tags: [['d', 'x']] }), artNew = ev(me, 'v2', { kind: 30023, created_at: 300, tags: [['d', 'x']] })
    const f = relays({ [A]: [n1, oldProfile, gone, artOld, stranger], [B]: [n2, newProfile, deletion, artNew] })
    const events = await collectBackup(f, me, [A, B])
    expect(f.asked.every((q) => (q.kinds?.length ?? 0) <= 5)).toBe(true)
    expect(events.map((e) => e.id).sort()).toEqual([n1.id, n2.id, newProfile.id, deletion.id, artNew.id].sort())
    const file = backupFile(me, events, Date.UTC(2026, 9, 15))
    expect(file.name).toBe(`nostr-backup-${me.slice(0, 8)}-2026-10-15.json`)
    expect(JSON.parse(file.text)).toMatchObject({ pubkey: me, events: expect.arrayContaining([expect.objectContaining({ id: n1.id, sig: n1.sig })]) })
  })
})
