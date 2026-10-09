// Is the page running as an installed app, and should it tell the visitor how to install it? Pure: the facts come from the browser, the decision is here.

export interface Env { standalone: boolean; ios: boolean }

/** iPhone/iPad Safari has no install button: the way is Share -> Add to Home Screen, so say so there. Nowhere else, and never once installed. */
export function installHint(env: Env): 'ios' | null {
  return env.ios && !env.standalone ? 'ios' : null
}

/** Reads the browser's own signals (iPadOS reports itself as a Mac with a touch screen). */
export function detectEnv(nav: { userAgent?: string; platform?: string; maxTouchPoints?: number; standalone?: boolean }, standaloneMedia: boolean): Env {
  const ua = nav.userAgent ?? ''
  const ios = /iphone|ipad|ipod/i.test(ua) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1)
  return { ios, standalone: nav.standalone === true || standaloneMedia }
}
