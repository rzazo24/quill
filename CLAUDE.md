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
