import './style.css'
import { poolFetcher } from './net/fetcher.js'
import { poolPublisher } from './net/publisher.js'
import { Signer } from './sign/signer.js'
import { startApp } from './ui/app.js'

const storage = ((): Storage | undefined => { try { return window.localStorage } catch { return undefined } })()
startApp(document.getElementById('app')!, {
  fetcher: poolFetcher(),
  publisher: poolPublisher(),
  signer: new Signer({ kv: storage }),
  storage,
  languages: navigator.languages,
  location,
  onHash: (cb) => addEventListener('hashchange', cb),
  setHash: (h) => { location.hash = h },
  copy: (text) => { void navigator.clipboard?.writeText(text).catch(() => {}) },
})
