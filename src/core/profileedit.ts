// Editing the reader's description (the `about` of their profile, kind 0). A profile is ONE event holding everything (name, picture, banner, NIP-05,
// lightning address, website, about…) and a new one REPLACES it: one built from a stale or partial copy would erase the rest. So Quill only ever signs
// the reader's newest profile with `about` changed and every other field, and every tag, exactly as they were.
import type { Event } from 'nostr-tools'
import type { Template } from '../sign/policy.js'

export const PROFILE_KIND = 0
export const MAX_ABOUT_CHARS = 2000

/** The profile's fields, or null when its content is not a JSON object (then Quill does not touch it). */
export function profileObject(e: Pick<Event, 'content'>): Record<string, unknown> | null {
  try { const v = JSON.parse(e.content) as unknown; return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null } catch { return null }
}

export const aboutOf = (e: Pick<Event, 'content'> | null | undefined): string => { const o = e ? profileObject(e) : null; return typeof o?.about === 'string' ? o.about : '' }

/** The next profile: `base` with only `about` set to the new text (the order of the other fields kept). Null when nothing changes, the text is too long or the profile is not one Quill can read. */
export function aboutTemplate(base: Event, about: string, now: number): Template | null {
  if (base.kind !== PROFILE_KIND || [...about].length > MAX_ABOUT_CHARS) return null
  const o = profileObject(base)
  if (!o || aboutOf(base) === about) return null
  return { kind: PROFILE_KIND, content: JSON.stringify({ ...o, about }), tags: base.tags.map((t) => [...t]), created_at: Math.max(now, base.created_at + 1) }
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Is the template exactly `base` with a new `about` and nothing else changed? (no field added, removed or altered, the same tags, newer) */
export function isAboutChange(base: Event, t: Template): boolean {
  if (base.kind !== PROFILE_KIND || t.kind !== PROFILE_KIND || !(t.created_at > base.created_at) || !same(base.tags, t.tags)) return false
  const before = profileObject(base), after = profileObject(t)
  if (!before || !after || typeof after.about !== 'string' || [...after.about].length > MAX_ABOUT_CHARS) return false
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const k of keys) if (k !== 'about' && (!(k in before) || !(k in after) || !same(before[k], after[k]))) return false
  return true
}
