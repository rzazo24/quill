// Runs before the page is first drawn: puts the chosen theme on <html> at once. The installed iPhone app paints the strip under the status bar from
// that first drawing, which was otherwise the default dark theme (app.ts applies the theme a moment later): a dark strip over a light page.
// Mirrors applyTheme in src/ui/app.ts and inHalloweenSeason in src/ui/store.ts.
(function () {
  var get = function (k) { try { return localStorage.getItem(k) } catch (e) { return null } }
  var scheme = get('scheme'), theme = get('theme'), d = new Date(), html = document.documentElement
  var season = (d.getMonth() === 9 && d.getDate() >= 24) || (d.getMonth() === 10 && d.getDate() === 1)
  var halloween = theme === 'halloween' || (theme !== 'default' && season)
  var light = !halloween && (scheme === 'light' || (scheme === 'auto' && matchMedia('(prefers-color-scheme: light)').matches))
  if (halloween) html.setAttribute('data-theme', 'halloween')
  if (light) html.setAttribute('data-scheme', 'light')
})()
