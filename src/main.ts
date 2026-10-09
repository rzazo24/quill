import './style.css'
import { poolFetcher } from './net/fetcher.js'
import { poolPublisher } from './net/publisher.js'
import { Signer } from './sign/signer.js'
import { startApp } from './ui/app.js'
import { detectEnv } from './ui/install.js'

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
  env: detectEnv(navigator as Navigator & { standalone?: boolean }, matchMedia('(display-mode: standalone)').matches),
  onVisible: (cb) => document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') cb() }),
})
