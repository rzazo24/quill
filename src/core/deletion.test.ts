import { describe, expect, it } from 'vitest'
import { deletionTemplate, isDeletionOf } from './deletion.js'
import { checkTemplate } from '../sign/policy.js'

const note = { id: 'a'.repeat(64), kind: 1, pubkey: '1'.repeat(64), content: 'oops', tags: [], created_at: 1, sig: '' }
describe('deleting one of your notes', () => {
  it('names exactly that note (e) and its kind (k), nothing else', () => {
    const t = deletionTemplate(note, 100)
    expect(t).toEqual({ kind: 5, content: '', tags: [['e', note.id], ['k', '1']], created_at: 100 })
    expect(isDeletionOf(note, t)).toBe(true); expect(checkTemplate(t, { deleteTarget: note })).toBeNull()
  })
  it('the signing rule refuses another note, more notes, other kinds or no target', () => {
    const t = deletionTemplate(note, 100)
    expect(checkTemplate({ ...t, tags: [['e', 'b'.repeat(64)], ['k', '1']] }, { deleteTarget: note })).toBe('delete')
    expect(checkTemplate({ ...t, tags: [...t.tags, ['e', 'b'.repeat(64)]] }, { deleteTarget: note })).toBe('delete')
    expect(checkTemplate(deletionTemplate({ ...note, kind: 3 }, 100), { deleteTarget: { ...note, kind: 3 } })).toBe('delete') // only notes
    expect(checkTemplate({ ...t, content: 'reason' }, { deleteTarget: note })).toBe('delete')
    expect(checkTemplate(t)).toBe('delete')
  })
})
