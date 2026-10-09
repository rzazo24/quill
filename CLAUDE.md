# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Quill: a text-only, light Nostr client whose filter explains every decision. Vite + TypeScript, static, no backend. Name chosen by the user (2026-10-09). Status: reading works (login by npub, Following, Mentions, thread, filter settings, EN/ES) and writing through a NIP-46 signer (Clave): note, reply, one-tap reaction. Not yet: notifications, NIP-65 outbox relays, PWA. NOT yet tried against the user's real Clave.

## Commands

```bash
npm run probe -- <npub>       # data layer against real relays (read-only), prints verdicts
node test/e2e.mjs <npub>      # real browser (Playwright) on the `npm run build` output; screenshots in .e2e/
npm test                      # vitest, src/**/*.test.ts
npx vitest run src/core/verdict.test.ts
npm run build                 # tsc -b && vite build
```

## Rules that must not erode

- **Text only.** Never load anything external (images, video, previews, fonts from CDNs). Links are plain text with the whole address visible (`segments` in `core/text.ts`); no `innerHTML` with third-party text, ever: build DOM with `textContent`.
- **The filter returns a verdict, not a boolean** (`core/verdict.ts`). A hidden note must always be able to say which rule and why; the UI folds it, never drops it. New rules must add a `RuleId`, params for the sentence, tests, and a row in the README table.
- **Missing data is never evidence**: unloaded graph or absent profile hides nothing alone. People the user follows and the user themself are never hidden by behaviour rules, only by the user's own mutes.
- Third-party text goes through `cleanText` before display or comparison.
- `core/` is pure (no DOM, no network) so it is testable without relays. Keep it that way; network and DOM live outside it.
- The rules come from nostrclaw's `triage.ts`/`text.ts` (`~/proyectos/nostrclaw/src`); there is deliberate duplication for now, not a shared package.

## Layout

`src/core` pure logic (text, NIP-10 threads, refs, identity, the filter) · `src/data` loading (follows, graph, mutes, feeds, threads) over an injected `Fetcher` · `src/net/fetcher.ts` the only code that talks to relays: drops events with a bad signature or that do not answer the filter, `memo` caches per page · `src/ui` DOM only through `h()`/`textContent` (no `innerHTML`), `app.ts` holds the state. The build ships a CSP meta tag (own script/style + `wss:` only); `frame-ancestors` has to be a response header from the web server.

## What was learned about Clave (iOS signer) — keep it in mind before changing the connection code

- Pair with a **`bunker://` address copied in Clave** (primary UI). Verified on a real iPhone/PC: signing is answered in ~1 s with Clave in the BACKGROUND. With `nostrconnect://` (link/QR) Clave answered only while open on screen, at Low, Medium and Full trust alike, even though pairing "succeeds" and the requests reach relay.powr.build. Clave's own docs (github.com/DocNR/clave README and docs/nip46-compatibility.md) say the push proxy watches ONE relay, relay.powr.build, and recommend bunker:// for the same device.
- iOS freezes a backgrounded app's sockets after ~5-10 s: a page cannot rely on listening live while the user is in another app. `src/sign/nip46.ts` is a client that also POLLS the relay (relay.powr.build stores kind 24133) so a late answer is found; it is tested but NOT wired into `Signer` yet (the bunker path signs in the background, so Safari stays in front). Wire it in if Clave needs to be opened to approve (e.g. Low trust).
- Do not put relays other than relay.powr.build in links that Clave must serve unless there is a reason; our own relay rejects kind 24133.
- When something looks broken, look at relay.powr.build directly (kind 24133, authors/`#p` of the user's key): it shows whether the request arrived and whether Clave answered, without decrypting anything.

## Installable app (PWA) — what must stay true

- `public/manifest.webmanifest`, the icons (`scripts/make-icons.mjs` renders the PNGs and favicon.ico from the quill drawing in `public/favicon.svg`), the page's `<link>`s and BOTH security policies (the meta tag in `vite.config.ts` and the header in `deploy/quill.caddy.template`) must agree: `src/pwa.test.ts` checks it, `npm run e2e:pwa` asks a real Chromium. `img-src 'self'` is for the app's own icons ONLY: never allow external images without a deliberate decision (privacy: profile pictures leak the reader's IP).
- Every build has an id: `vite.config.ts` bakes it into the bundle as `__BUILD__` and emits `/version.json` ({ build }); the app asks for it (`checkVersion` in `main.ts`, `isNewer` in `ui/update.ts`: only a short `[a-z0-9]` id counts) at start, when it returns to the foreground and every 10 min, and shows the update bar. This needs `connect-src 'self'` (page reads its own file) and `Cache-Control: no-cache` on version.json (the Caddy template already revalidates everything but /assets/*). `npm run e2e:pwa` checks all of it, including a fake newer build.
- **App shell layout**: `html/body` are fixed to the viewport (`100dvh`, `overflow: hidden`), `#app` is a column (header, `main.view`, `.tabbar`) and ONLY `main.view` scrolls. Do not go back to a scrolling page with a `position: fixed` tab bar: on iPhone Safari the toolbar shows/hides with the page's scroll and pushed the bar up while a list was emptied and refilled. `draw()` rebuilds `<main>` every time, so it reads its `scrollTop` FIRST (building the new one moves the list out of the old one, which collapses to 0) and restores it, except on a new view. `npm run e2e:shell` checks it in a phone-sized Chromium (bar position sampled during a load, page never scrollable, a reaction does not move the note).
- No service worker on purpose (live data; an offline shell is useless and stale caches are a risk). Web push later would need one.
- An installed iPhone app has its OWN localStorage: a separate login and Clave pairing from Safari's. The header pads `env(safe-area-inset-top)` (status bar is translucent); the body must not.
- Installed apps have no pull-to-refresh: the ↻ button, re-tapping the current tab and coming back after >2 min all call `refresh()`.

## Signing rules that must not erode

- The user's private key never enters Quill (no nsec field anywhere; `parseIdentity` refuses an nsec on sight and does not echo it). Quill keeps only an app key (localStorage `signer`) and the signer's key/relays.
- `src/sign/policy.ts` is the only list of what may be signed: kinds 1 and 7, tag names e/p/t/k/a, limits. `Signer.sign` applies it BEFORE asking and then verifies what came back (signature, author = connected key, kind/content/tags identical, created_at within 5 min). Never relax these because the user's Clave is on medium/full trust: that is exactly when Quill's own checks are the only ones.
- One sign request per action, no "are you awake?" ping first (it doubled the notifications and, with Clave in the background, made Quill give up before a trust level that auto-approves could answer). Waiting is abortable and bounded (5 min).
- While waiting for the signer, a new tap REPLACES the old request (a request made while Clave is closed is never picked up later, so tapping again after opening Clave must work); once the signature exists and the event is being sent, extra taps are ignored. The wait is 90 s, and progress/result/errors live in a bar fixed to the bottom of the screen, because a status at the top of the page goes unseen while scrolling notes.
- Reactions are one tap on purpose; notes and replies always go through the review screen that shows the exact event. Keep it that way.
- A signer whose key differs from the account being read is disconnected, never used.
- Test with `test/support/fake-signer.ts` (speaks real NIP-46 through the real khatru relay binary; skipped without it). Add a tamper case for every new thing that is verified.

## Process

Same as the user's other projects: tests with the change, a mutation check on new filter rules (break the rule, see a test fail), probe against real relays before calling something done, no push or deploy without the user's go-ahead.
