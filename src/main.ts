import './style.css'
import { poolFetcher } from './net/fetcher.js'
import { poolPublisher } from './net/publisher.js'
import { probeRelay } from './net/relays.js'
import { Signer } from './sign/signer.js'
import { startApp } from './ui/app.js'
import { detectEnv } from './ui/install.js'
import { isNewer } from './ui/update.js'

const storage = ((): Storage | undefined => { try { return window.localStorage } catch { return undefined } })()
let relays: string[] = [] // set by the app at start, then whenever the reader edits the list in Settings
const current = () => relays
startApp(document.getElementById('app')!, {
  fetcher: poolFetcher(current),
  publisher: poolPublisher(current),
  setRelays: (list) => { relays = list },
  probeRelay: (url) => probeRelay(url),
  signer: new Signer({ kv: storage, appUrl: location.origin }),
  storage,
  languages: navigator.languages,
  location,
  onHash: (cb) => addEventListener('hashchange', cb),
  setHash: (h) => { location.hash = h },
  copy: (text) => { void navigator.clipboard?.writeText(text).catch(() => {}) },
  readClipboard: () => navigator.clipboard.readText(),
  checkVersion: async () => { try { const r = await fetch('/version.json', { cache: 'no-store' }); return isNewer(await r.json(), __BUILD__) } catch { return false } },
  onTick: (cb) => { setInterval(cb, 10 * 60_000) },
  onPoll: (cb) => { setInterval(() => { if (document.visibilityState === 'visible') cb() }, 60_000) },
  reload: () => location.reload(),
  env: detectEnv(navigator as Navigator & { standalone?: boolean }, matchMedia('(display-mode: standalone)').matches),
  onVisible: (cb) => document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') cb() }),
})
