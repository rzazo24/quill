// A picture for every account without loading anything: a colour taken from the public key and the initials of the name. Pure and deterministic.

export interface Avatar { hue: number; letters: string }

const HEX = /^[0-9a-f]{6}/i

/** The first one or two letters of a display name (words first, then characters), upper case. An emoji counts as one character. */
export function initials(name: string | undefined): string {
  const words = (name ?? '').replace(/[^\p{L}\p{N}\p{Extended_Pictographic}\s]/gu, ' ').split(/\s+/).filter(Boolean)
  const first = (w: string | undefined) => [...(w ?? '')][0] ?? ''
  const letters = words.length >= 2 ? first(words[0]) + first(words[1]) : [...(words[0] ?? '')].slice(0, 2).join('')
  return letters.toUpperCase()
}

/** `name` is the display name if there is one; without it the first characters of the key stand in (never empty). */
export function avatarOf(pubkey: string, name?: string): Avatar {
  const hue = HEX.test(pubkey) ? parseInt(pubkey.slice(0, 6), 16) % 360 : 0
  return { hue, letters: initials(name) || pubkey.slice(0, 2).toUpperCase() }
}
