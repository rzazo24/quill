# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Quill: a text-only, light Nostr client whose filter explains every decision. Vite + TypeScript, static, no backend. Name chosen by the user (2026-10-09). Status: reading works (login by npub, Following, Mentions, thread, filter settings, EN/ES). Not yet: publishing/replying/reacting (NIP-46), notifications, NIP-65 outbox relays, PWA.

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

## Process

Same as the user's other projects: tests with the change, a mutation check on new filter rules (break the rule, see a test fail), probe against real relays before calling something done, no push or deploy without the user's go-ahead.
