// Is there a newer version of the app than the one running? The server publishes /version.json ({ build }) with every deploy; the running bundle knows
// its own build id. What the server answers is untrusted data like anything else: only a short plain id counts.

/** True when `remote` (parsed version.json) names a build different from `current`. A development build never asks for an update. */
export function isNewer(remote: unknown, current: string): boolean {
  if (!current || current === 'dev') return false
  const build = (remote as { build?: unknown } | null)?.build
  return typeof build === 'string' && /^[a-z0-9]{4,20}$/.test(build) && build !== current
}
