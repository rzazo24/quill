import { describe, expect, it } from 'vitest'
import { aboutOf, aboutTemplate, isAboutChange, MAX_ABOUT_CHARS } from './profileedit.js'
import { checkTemplate } from '../sign/policy.js'

const me = '1'.repeat(64)
const base = { id: 'f'.repeat(64), pubkey: me, kind: 0, created_at: 100, sig: '', tags: [['alt', 'profile']], content: JSON.stringify({ name: 'Zhash', picture: 'https://p.example/me.png', banner: 'https://p.example/b.png', nip05: 'z@example.com', lud16: 'z@wallet.example', website: 'https://z.example', about: 'old text', custom: { nested: [1, 2] } }) }

describe('editing the description', () => {
  it('changes only about: every other field (unknown ones too) and every tag kept, newer than the base', () => {
    const t = aboutTemplate(base, 'new text\nwith a line', 200)!
    const before = JSON.parse(base.content), after = JSON.parse(t.content)
    expect(after).toEqual({ ...before, about: 'new text\nwith a line' }); expect(Object.keys(after)).toEqual(Object.keys(before)); expect(t.tags).toEqual(base.tags); expect(t.created_at).toBe(200)
    expect(isAboutChange(base, t)).toBe(true); expect(checkTemplate(t, { profileBase: base })).toBeNull()
  })
  it('the signing rule refuses anything else: another field changed, one dropped or added, other tags, no base', () => {
    const t = aboutTemplate(base, 'x', 200)!, o = JSON.parse(t.content)
    for (const content of [JSON.stringify({ ...o, name: 'Other' }), JSON.stringify({ ...o, picture: undefined }), JSON.stringify({ ...o, extra: 1 }), 'not json'])
      expect(checkTemplate({ ...t, content }, { profileBase: base }), content).toBe('profile')
    expect(checkTemplate({ ...t, tags: [] }, { profileBase: base })).toBe('profile')
    expect(checkTemplate({ ...t, created_at: 50 }, { profileBase: base })).toBe('profile')
    expect(checkTemplate(t)).toBe('profile')
  })
  it('nothing to do, too long, or an unreadable profile: no template', () => {
    expect(aboutTemplate(base, 'old text', 200)).toBeNull(); expect(aboutTemplate(base, 'a'.repeat(MAX_ABOUT_CHARS + 1), 200)).toBeNull(); expect(aboutTemplate({ ...base, content: '[1]' }, 'x', 200)).toBeNull()
    expect(aboutOf(base)).toBe('old text'); expect(aboutOf(null)).toBe('')
  })
  it('a profile with no about yet gets one, at the end', () => {
    const b = { ...base, content: JSON.stringify({ name: 'Zhash' }) }
    const t = aboutTemplate(b, 'hello', 200)!; expect(JSON.parse(t.content)).toEqual({ name: 'Zhash', about: 'hello' }); expect(checkTemplate(t, { profileBase: b })).toBeNull()
  })
})
