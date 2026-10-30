// Runs before the page is drawn: gives the status bar (theme-color) the page's own background at once. iOS reads it when the app opens and does not
// always follow later changes, so app.ts setting it was too late and left a dark band above a light page. Mirrors applyTheme in src/ui/app.ts.
(function () {
  var get = function (k) { try { return localStorage.getItem(k) } catch (e) { return null } }
  var scheme = get('scheme'), theme = get('theme'), d = new Date()
  var season = (d.getMonth() === 9 && d.getDate() >= 24) || (d.getMonth() === 10 && d.getDate() === 1)
  var halloween = theme === 'halloween' || (theme !== 'default' && season)
  var light = !halloween && (scheme === 'light' || (scheme === 'auto' && matchMedia('(prefers-color-scheme: light)').matches))
  var meta = document.querySelector('meta[name=theme-color]')
  if (meta) meta.setAttribute('content', halloween ? '#0f0a16' : light ? '#f5f7f9' : '#0b0f16')
})()
