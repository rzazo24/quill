import './style.css'
import { poolFetcher } from './net/fetcher.js'
import { poolPublisher } from './net/publisher.js'
import { Signer } from './sign/signer.js'
import { startApp } from './ui/app.js'
import { detectEnv } from './ui/install.js'
import { isNewer } from './ui/update.js'

const storage = ((): Storage | undefined => { try { return window.localStorage } catch { return undefined } })()
startApp(document.getElementById('app')!, {
  fetcher: poolFetcher(),
  publisher: poolPublisher(),
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
  reload: () => location.reload(),
  env: detectEnv(navigator as Navigator & { standalone?: boolean }, matchMedia('(display-mode: standalone)').matches),
  onVisible: (cb) => document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') cb() }),
})
