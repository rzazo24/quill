// What is remembered on this device. Storage can be missing or throw (private windows, blocked data), and what is in it can be anything:
// every read is checked, every failure is silent, and the app works without it.
import { DEFAULT_SETTINGS, type Settings } from '../core/verdict.js'
import type { Lang } from './i18n.js'

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export function safeGet(kv: KV | undefined, key: string): string | null { try { return kv?.getItem(key) ?? null } catch { return null } }
export function safeSet(kv: KV | undefined, key: string, value: string | null): void {
  try { if (value === null) kv?.removeItem(key); else kv?.setItem(key, value) } catch { /* nothing to do */ }
}

/** Settings from storage: anything unexpected falls back to the default, field by field. */
export function parseSettings(raw: string | null): Settings {
  const d = DEFAULT_SETTINGS
  try {
    const o = JSON.parse(raw ?? 'null') as Partial<Settings> | null
    if (!o || typeof o !== 'object') return d
    const bool = (v: unknown, dflt: boolean) => (typeof v === 'boolean' ? v : dflt)
    const r = (o.rules ?? {}) as Partial<Settings['rules']>
    return {
      rules: { repeatedText: bool(r.repeatedText, d.rules.repeatedText), burst: bool(r.burst, d.rules.burst), linkOnly: bool(r.linkOnly, d.rules.linkOnly), outsideNetwork: bool(r.outsideNetwork, d.rules.outsideNetwork) },
      maxDistance: o.maxDistance === 1 || o.maxDistance === 2 ? o.maxDistance : d.maxDistance,
      burstEvents: d.burstEvents,
    }
  } catch { return d }
}

export const parseLang = (raw: string | null): Lang | null => (raw === 'en' || raw === 'es' ? raw : null)

export function parseWords(raw: string | null): string[] {
  return [...new Set((raw ?? '').split('\n').map((w) => w.trim().toLowerCase().slice(0, 60)).filter(Boolean))].slice(0, 100)
}
