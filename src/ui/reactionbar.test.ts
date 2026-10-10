// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { ev, pk } from '../core/testutil.js'
import { reactionBar } from './sign-ui.js'

const v = { lang: 'en' as const, names: new Map<string, string>() }
const mine = (...r: string[]) => ({ reactions: new Set(r), replied: false, reposted: false })
const bar = (m = mine()) => reactionBar(ev(pk('a'), 'hi'), () => {}, () => {}, v, m)
const visible = (el: HTMLElement) => [...el.querySelectorAll(':scope > button.react:not(.share)')].map((b) => b.textContent)
const folded = (el: HTMLElement) => [...el.querySelectorAll('.more-reactions-list button')].map((b) => b.textContent)

describe('reactions in the bar', () => {
  it('three are always at hand and the rest wait behind a + that opens them', () => {
    const el = bar(); expect(visible(el)).toEqual(['👍', '❤️', '🤙']); expect(folded(el)).toEqual(['😂', '🙏', '🔥', '😮', '😢', '🎉', '💯'])
    const box = el.querySelector('.more-reactions')!, toggle = box.querySelector('.more-toggle') as HTMLElement
    expect(toggle.getAttribute('aria-expanded')).toBe('false'); expect(toggle.getAttribute('aria-label')).toBe('More reactions')
    toggle.click(); expect(box.classList.contains('open')).toBe(true); expect(toggle.getAttribute('aria-expanded')).toBe('true')
    toggle.click(); expect(box.classList.contains('open')).toBe(false)
  })
  it('a reaction already given is always shown, lit, even if it would be folded (and one given from elsewhere too)', () => {
    const el = bar(mine('🙏', '🥳')); expect(visible(el)).toEqual(['👍', '❤️', '🤙', '🙏', '🥳']); expect(folded(el)).toEqual(['😂', '🔥', '😮', '😢', '🎉', '💯'])
    expect(el.querySelectorAll('button.react.on')).toHaveLength(2)
  })
  it('with everything given or visible there is no + at all', () => {
    expect(bar(mine('😂', '🙏', '🔥', '😮', '😢', '🎉', '💯')).querySelector('.more-reactions')).toBeNull()
  })
})
