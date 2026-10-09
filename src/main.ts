import './style.css'
import { poolFetcher } from './net/fetcher.js'
import { startApp } from './ui/app.js'

const storage = ((): Storage | undefined => { try { return window.localStorage } catch { return undefined } })()
startApp(document.getElementById('app')!, {
  fetcher: poolFetcher(),
  storage,
  languages: navigator.languages,
  location,
  onHash: (cb) => addEventListener('hashchange', cb),
  setHash: (h) => { location.hash = h },
})
