import type { Event, Filter } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import { ev, pk } from '../core/testutil.js'
import { answers, type Fetcher } from '../net/fetcher.js'
import type { Publisher } from '../net/publisher.js'
import { backupFile, checkHeld, collectBackup, copyNotes, coverage, missedEvents, readBackup, scanNotes, snapshots, type CopyResult } from './rescue.js'

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

  it('copies each relay what it lacks, newest first, exactly as signed; a relay that asks to slow down gets the note again; one that refuses ten in a row is left alone, one that refuses only some keeps getting the rest', async () => {
    const sent: [string, string][] = []
    const old = Array.from({ length: 4 }, (_, i) => ev(me, `old ${i}`, { created_at: 100 + i })), fresh = Array.from({ length: 3 }, (_, i) => ev(me, `new ${i}`, { created_at: 9000 + i }))
    const blocked = Array.from({ length: 12 }, (_, i) => ev(me, `b ${i}`))
    let slowOnce = true
    const p: Publisher = { publish: async (e, rs): Promise<Record<string, string>> => { const r = rs![0]!; sent.push([r, e.id])
      if (r === A) return { [r]: e.created_at < 1000 ? 'blocked: not in our web of trust' : 'ok' }
      if (r === B) return { [r]: 'blocked: not allowed' }
      if (slowOnce) { slowOnce = false; return { [r]: 'rate-limited: slow down' } }
      return { [r]: e.id === n2.id ? 'duplicate: already have it' : 'ok' } } }
    const lacking = new Map([[A, [...old, ...fresh]], [B, blocked], [C, [n2, n1]]])
    const progress: number[] = []
    const out = await copyNotes(p, lacking, (d) => progress.push(d), 0)
    expect(out.map(({ missed, ...r }) => r)).toEqual([{ relay: A, sent: 7, ok: 3, failed: 4, reason: 'blocked: not in our web of trust' }, { relay: B, sent: 10, ok: 0, failed: 10, reason: 'blocked: not allowed' }, { relay: C, sent: 2, ok: 2, failed: 0 }])
    expect(out[0]!.missed!.map((e) => e.id).sort()).toEqual(old.map((e) => e.id).sort()) // what was refused…
    expect(out[1]!.missed).toHaveLength(12) // …and what was never tried after the relay gave up
    expect(out[2]!.missed).toEqual([])
    expect(sent.filter(([r]) => r === A).map(([, id]) => id).slice(0, 3)).toEqual([...fresh].reverse().map((e) => e.id)) // newest first
    expect(sent.filter(([r]) => r === C)).toHaveLength(3) // the slowed-down note was sent again
    expect(progress.at(-1)).toBe(21) // the notes never sent to B still count as done
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

  it('an article deleted by its address stays out of the file (every version up to the deletion), and the deletion stays in', async () => {
    const art = ev(me, 'removed', { kind: 30023, created_at: 100, tags: [['d', 'gone']] }), later = ev(me, 'written again', { kind: 30023, created_at: 500, tags: [['d', 'again']] })
    const again = ev(me, 'republished after', { kind: 30023, created_at: 400, tags: [['d', 'again']] })
    const del = ev(me, '', { kind: 5, created_at: 200, tags: [['a', `30023:${me}:gone`], ['a', `30023:${me}:again`]] })
    const events = await collectBackup(relays({ [A]: [art, del, again, later] }), me, [A])
    expect(events.map((e) => e.id).sort()).toEqual([del.id, later.id].sort())
  })
})

describe('restoring from a file', () => {
  const me1 = pk('1')
  it('deletions are sent last, so they find the note they delete', async () => {
    const note = ev(me1, 'to delete', { created_at: 100 }), del = ev(me1, '', { kind: 5, created_at: 200, tags: [['e', note.id]] }), other = ev(me1, 'kept', { created_at: 300 })
    const order: string[] = []
    const p: Publisher = { publish: async (e, rs) => { order.push(e.id); return { [rs![0]!]: 'ok' } } }
    await copyNotes(p, new Map([[A, [del, other, note]]]), undefined, 0)
    expect(order).toEqual([other.id, note.id, del.id])
  })
  it('an "ok" is checked by asking the relay for the ids: what it does not serve did not land, and goes in the file of what did not land', async () => {
    const a = ev(me1, 'kept', { created_at: 1 }), b = ev(me1, 'said ok, not kept', { created_at: 2 }), c = ev(me1, 'refused', { created_at: 3 })
    const results: CopyResult[] = [{ relay: A, sent: 3, ok: 2, failed: 1, missed: [c] }, { relay: B, sent: 1, ok: 1, failed: 0, missed: [] }]
    const checked = await checkHeld(relays({ [A]: [a], [B]: [a] }), new Map([[A, [a, b, c]], [B, [a]]]), results)
    expect(checked.map((r) => [r.relay, r.held, r.missed!.map((e) => e.id)])).toEqual([[A, 1, [c.id, b.id]], [B, 1, []]])
    expect(missedEvents(checked).map((e) => e.id)).toEqual([c.id, b.id])
    const down = await checkHeld(relays({}, { down: [A] }), new Map([[A, [a]]]), [{ relay: A, sent: 1, ok: 1, failed: 0, missed: [] }])
    expect(down[0]!.held).toBeUndefined() // could not ask: the relay's own answer stands
  })
  it('the replaceable lists in a file, with their dates', () => {
    expect(snapshots([ev(me1, '', { kind: 1, created_at: 5 }), ev(me1, '{}', { kind: 3, created_at: 7 }), ev(me1, '{}', { kind: 0, created_at: 9 })])).toEqual([{ kind: 0, at: 9 }, { kind: 3, at: 7 }])
  })
  const me = pk('1'), ok = (e: Event) => e.content !== 'tampered'
  it('reads the file this app saves, and a plain list too: only this account\'s validly signed events, once each, newest first', () => {
    const a = ev(me, 'first', { created_at: 100 }), b = ev(me, 'second', { created_at: 200 }), theirs = ev(pk('2'), 'not mine'), bad = ev(me, 'tampered')
    const file = backupFile(me, [a, b, theirs, bad, a], 0).text
    expect(readBackup(file, me, ok)).toEqual({ events: [b, a], skipped: 3 })
    expect(readBackup(JSON.stringify([a]), me, ok).events).toEqual([a])
  })
  it('anything that is not a backup gives nothing', () => {
    expect(readBackup('not json', me, ok)).toEqual({ events: [], skipped: 0 })
    expect(readBackup('{"events":[{"id":1}]}', me, ok)).toEqual({ events: [], skipped: 1 })
  })
})
