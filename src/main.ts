import './style.css'
import { poolFetcher } from './net/fetcher.js'
import { SEARCH_RELAYS } from './data/search.js'
import { workerVerifier } from './net/verifier.js'
import { poolPublisher } from './net/publisher.js'
import { probeRelay } from './net/relays.js'
import { Signer, type Nip07 } from './sign/signer.js'
import { startApp } from './ui/app.js'
import { detectEnv } from './ui/install.js'

/** Installed on an iPhone, the page may stop short of the bottom of the screen (the strip under it belongs to the home indicator): style.css then
 *  drops the bar's own room for the indicator and paints the strip like the bar. Only in the installed app: in a browser, toolbars take that room. */
function markEdgeGap(): void {
  const installed = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  const tall = innerHeight >= innerWidth ? Math.max(screen.height, screen.width) : Math.min(screen.height, screen.width)
  document.documentElement.classList.toggle('edge-gap', installed && tall - innerHeight > 20)
}
markEdgeGap(); addEventListener('resize', markEdgeGap)
import { isNewer } from './ui/update.js'

const storage = ((): Storage | undefined => { try { return window.localStorage } catch { return undefined } })()
let relays: string[] = [] // set by the app at start, then whenever the reader edits the list in Settings
const current = () => relays
startApp(document.getElementById('app')!, {
  fetcher: poolFetcher(current, 6000, typeof Worker === 'undefined' ? undefined : workerVerifier(() => new Worker(new URL('./net/verify.worker.ts', import.meta.url), { type: 'module' }), Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)))),
  searchFetcher: poolFetcher(SEARCH_RELAYS, 6000),
  publisher: poolPublisher(current),
  setRelays: (list) => { relays = list },
  probeRelay: (url) => probeRelay(url),
  signer: new Signer({ kv: storage, appUrl: location.origin, extension: () => (window as Window & { nostr?: Nip07 }).nostr }),
  pickSource: async () => { const r = await fetch('/digest/latest.json', { cache: 'no-store' }); return r.ok ? r.json() : null },
  // thumbnails from this site's own server (quill-avatars); a local preview has none, so the pictures come straight from their sites
  ...(location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? {} : { avatarProxy: `${location.origin}/avatar` }),
  storage,
  languages: navigator.languages,
  location,
  onHash: (cb) => addEventListener('hashchange', cb),
  setHash: (h) => { location.hash = h },
  copy: (text) => { void navigator.clipboard?.writeText(text).catch(() => {}) },
  readClipboard: () => navigator.clipboard.readText(),
  // the copy of everything the reader published: on an iPhone or iPad the share sheet ("Save to Files"), since an installed web app cannot download; elsewhere a download
  saveFile: async (name, text) => {
    const file = new File([text], name, { type: 'application/json' })
    const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    if (apple && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return } catch (e) { if (e instanceof DOMException && e.name === 'AbortError') return /* the reader closed the sheet */ }
    }
    const url = URL.createObjectURL(file), a = Object.assign(document.createElement('a'), { href: url, download: name })
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30_000)
  },
  checkVersion: async () => { try { const r = await fetch('/version.json', { cache: 'no-store' }); return isNewer(await r.json(), __BUILD__) } catch { return false } },
  onTick: (cb) => { setInterval(cb, 10 * 60_000) },
  onPoll: (cb) => { setInterval(() => { if (document.visibilityState === 'visible') cb() }, 60_000) },
  reload: () => location.reload(),
  goBack: () => { if (history.length > 1) history.back(); else location.hash = '' },
  prefersLight: () => matchMedia('(prefers-color-scheme: light)').matches,
  onSchemeChange: (cb) => matchMedia('(prefers-color-scheme: light)').addEventListener('change', cb),
  isWide: () => matchMedia('(min-width: 1100px)').matches,
  onWide: (cb) => matchMedia('(min-width: 1100px)').addEventListener('change', cb),
  env: detectEnv(navigator as Navigator & { standalone?: boolean }, matchMedia('(display-mode: standalone)').matches),
  onVisible: (cb) => { let hiddenAt = 0; document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') hiddenAt = Date.now(); else cb(hiddenAt ? Date.now() - hiddenAt : 0) }) },
})
