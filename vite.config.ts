import { defineConfig, type Plugin } from 'vite'

// Text only is enforced by the browser, not just by the code: the built page may load its own script and style, talk to relays over
// wss://, and nothing else (no images, fonts, frames, media or forms). Only in the build: the dev server needs inline scripts for hot reload.
// (`frame-ancestors` cannot be set from a meta tag: the web server must send it as a header when this is deployed.)
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; manifest-src 'self'; connect-src wss:; base-uri 'none'; form-action 'none'"
const csp = (): Plugin => ({
  name: 'csp', apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
})

export default defineConfig({ plugins: [csp()], build: { target: 'es2022' }, test: { environment: 'node', include: ['src/**/*.test.ts'] } })
