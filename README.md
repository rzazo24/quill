# Quill

**[English](README.md) · [Español](README.es.md)**

A small, **text-first** [Nostr](https://nostr.com) client that **tells you why it hides things**.

Live at **<https://quill.hivescope.xyz>**. Paste an `npub` to read; connect a signer ([Clave](https://clave.casa) on iPhone) to react, reply and write. Quill never sees your private key.

## Three promises

1. **Text first.** Nothing external is ever loaded: no images, no video, no link previews, no profile pictures from other servers (avatars are drawn from the account's key and name). Links are shown as plain text with the whole address visible, and only open when you click them. This is enforced by the browser, not just by the code: the page ships a Content-Security-Policy that allows its own script, style and icons, and `wss://` connections to relays, nothing else.
2. **Light.** One static page, no backend, around 60 KB of JavaScript (gzipped).
3. **A filter that explains itself.** Nothing is hidden silently. Every hidden note is folded into one line that says which rule hid it and what the rule saw, and one tap shows it. A counter tells you how much was hidden and by what.

## How the filter decides

Every note gets a *verdict* (`src/core/verdict.ts`): shown or hidden, by which rule, with the numbers behind it. In order of precedence:

| Rule | Hides when | Never applies to |
|---|---|---|
| muted author / word | you muted them | — |
| repeated text | most of a key's notes are the same text other keys post (3+ words or a link) | you, people you follow |
| burst | 5+ notes inside a minute | you, people you follow |
| link only | 3+ notes, almost all with links | you, people you follow |
| outside your network | further than N hops in the follow graph (default 2) | you, people you follow |

Principles: behaviour is evidence, **missing data is not** (a key without a profile, or a follow graph that has not loaded yet, never hides anything by itself); people you chose are never hidden by behaviour; a short greeting repeated by many keys is a greeting, not spam. Each rule can be switched off. The rules come from the triage in [nostrclaw](https://github.com/rzazo24/nostrclaw).

## What it does

- **Following**, **Mentions** (where the filter earns its keep), **Me** (your account, your Clave connection, the filter settings, your own notes) and any **thread**.
- **In-app notifications**: a number on *Mentions*, new notes marked, and a list of who reacted to your notes.
- **React** with one tap; what you already reacted to or replied to is marked; **reply** and **write a note** through a review screen that shows the exact text, kind, tags and relays before anything is asked of your signer.
- **Settings**: your own relay list (with a connection test; optionally published on Nostr as your NIP-65 list, and used as the starting point on a new device) and four text sizes, both remembered on the device.
- English and Spanish; dark theme; mobile first, and fine on a desktop.
- Installable as an app on iPhone and Android.

### What it does not do (on purpose, or not yet)

No direct messages, zaps, search, lists, media or long-form articles. The relay list is yours to edit in *Me → Settings* (secure `wss://` addresses only, 1 to 10, default six public relays), but it is one list for everything, not read per author (NIP-65). No system notifications (they would need a service worker and push); instead, while the app is open it looks once a minute and shows a number on *Mentions* for what is new since your last visit (replies, mentions and reactions to your notes; whatever the filter would hide is not counted, it is listed apart). No offline mode: the notes come live from the relays, so a cached copy would only show an empty shell.

## Writing: Quill never sees your private key

*Connect Clave* asks you to paste the **`bunker://` address** that Clave gives you (or press *Paste and connect* after copying it in Clave). Clave holds the key and signs; Quill keeps only an app key, saved in this browser, that identifies it to Clave.

**Why `bunker://` and not a link:** Clave signs in the background only for clients paired this way (its push service wakes it for requests sent through `relay.powr.build`). With a `nostrconnect://` link or QR, tested on an iPhone, Clave answered only while it was open on screen. The link is still offered as an alternative (*Use a link instead*).

- Quill sends **one** request to the signer (one notification) and waits up to 90 seconds, with a Cancel button; nothing is published unless the signer signs. A new tap replaces a request still waiting.
- What comes back is **verified**: valid signature, your key, and exactly the kind, content and tags that were asked for (a signer that adds a hidden mention is refused). Then it publishes to the relays and shows the result **per relay**, with a retry for the ones that failed that needs no new signature.
- Quill's own policy only ever signs notes (≤ 1000 characters), reactions and, when you press the button in Settings, your relay list (NIP-65, kind 10002, in exactly the shape Quill builds), at most 20 signatures per hour, **whatever trust level you give it in the signer**. Suggested level for Quill in Clave: *medium* (it auto-approves kinds 1, 6 and 7, which is all Quill needs); *full* also approves deletions, follow lists and relay lists, which Quill never asks for.
- A signer for a different account than the one you are reading as is refused and disconnected.

## Install it as an app

- **iPhone (Safari):** Share → Add to Home Screen.
- **Android (Chrome):** menu → Install app.

Once installed it opens full screen with its own icon. It **keeps its own data**, separate from the browser: you log in and connect your signer again inside it. There is no pull-to-refresh: use the **↻** button, tap the current tab again, or just come back after a few minutes (it refreshes by itself after two).

**New versions announce themselves.** Every build has an id, published as `/version.json`; the app compares it with its own when it starts, when you come back to it and every ten minutes, and shows an *Update* bar when they differ (the button just reloads the page).

## Develop

```bash
npm install
npm test            # unit and integration tests (the signer against a real relay binary is skipped without RELAY_BIN)
npm run build       # type-check + production build
npm run dev
```

Checks in real browsers (Playwright's Chromium), run against `npm run build`:

```bash
node test/e2e.mjs <npub>               # the whole reading flow against the real relays
npm run e2e:sign                       # connection handshake with a pretend Clave (QUILL_URL=… tests a deployed copy)
npm run e2e:pwa                        # is the page installable, is the manifest right, does the update notice work
node test/e2e-shell.mjs <hex pubkey>   # the layout: the page never scrolls, only the content; the tab bar never moves
node test/e2e-align.mjs <hex pubkey>   # desktop alignment with classic scrollbars shown
npm run probe -- <npub>                # the data layer against the real relays: what the filter would do
```

Layout of the code: `src/core` pure logic (text safety, threads, the filter) · `src/data` loading follows, graph, mutes, feeds · `src/net` the only code that talks to relays (it drops events with a bad signature or that do not answer the question asked) · `src/sign` the NIP-46 signer, the signing policy and the sign-and-publish pipeline · `src/ui` the page (DOM built with `textContent`, never `innerHTML`). `CLAUDE.md` has the design rules that must not erode and what was learned about iOS, Android and Clave.

### Deploy

`scripts/deploy.sh <relay-repo> <domain>` builds, copies `dist/` next to a [Caddy](https://caddyserver.com) site block (`deploy/quill.caddy.template`, with the strict security headers), **validates the whole Caddy configuration** and only then reloads it; if validation fails it restores the previous files.

## Prior art

Looked at before starting (October 2026): Coracle hides notes under a web-of-trust threshold without saying why; nostui is a terminal client with no spam filtering.

## License

[MIT](LICENSE) © 2026 rzazo24. Free to use, copy, modify and distribute, with no warranty.
