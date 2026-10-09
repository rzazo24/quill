# Quill

A tiny **text-only** Nostr client that **tells you why it hides things**.

> Status: early. You can read (following, mentions, threads) with a filter that explains itself, and write, reply and react by signing with Clave (NIP-46). Notifications, per-author relays (NIP-65) and a PWA come next.

## Three promises

1. **Text only.** Nothing external is ever loaded: no images, no video, no link previews. Links are shown as plain text with the whole address visible, and only open when you click them.
2. **Light.** One static page, no server, almost no dependencies.
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

Principles: behaviour is evidence, **missing data is not** (a key without a profile, or a follow graph that has not loaded yet, never hides anything by itself); people you chose are never hidden by behaviour; a short greeting repeated by many keys is a greeting, not spam. Each rule can be switched off.

## What it does today

Paste an npub: Quill reads your follows, mutes (public part) and the follow graph two hops out from the relays, then shows **Following**, **Mentions** (where the filter earns its keep) and any **thread**. Hidden notes are folded under a sentence such as *"Hidden: No path from you to this account within 2 hops"*; tap to open. A summary line counts what each rule hid, and *Filter settings* switches rules off live. English and Spanish.

Enforced by the browser, not just by the code: the production page ships a Content-Security-Policy that allows only its own script and style and `wss://` connections. Third-party text is never turned into markup (no `innerHTML` anywhere).

## Writing: Quill never sees your private key

*Connect Clave* shows a link to open in Clave (or paste a `bunker://` address). Clave holds the key and signs; Quill keeps only an app key, saved in this browser, that identifies it to Clave. The connection asks for `sign_event` of kinds 1 and 7 only.

- **React** under a note: one tap. **Reply** and **new note**: a review screen shows the exact text, kind, tags and relays before anything is asked of Clave.
- Before asking you to approve, Quill checks that Clave is awake (so you are not left waiting on a sleeping phone), then verifies what comes back: valid signature, your key, and exactly the kind, content and tags that were asked for (a signer that adds a hidden mention is refused). Then it publishes to the relays and shows the result **per relay**, with a retry for the ones that failed that does not need a new signature.
- Quill's own policy only ever signs notes (≤ 1000 characters) and reactions, at most 20 signatures per hour, whatever trust level you give it in Clave. **Suggested trust level for Quill in Clave: medium** (it auto-approves kinds 1, 6 and 7, which is all Quill needs); full also approves deletions, follow lists and relay lists, which Quill never asks for.
- A signer for a different account than the one you are reading as is refused and disconnected.

## Develop

```bash
npm install
npm test        # unit tests of the core
npm run build   # type-check + production build
npm run dev
npm run probe -- <npub>        # data layer against the real relays, prints what the filter would do
node test/e2e.mjs <npub>       # real browser (Playwright) against `npm run build` output; screenshots in .e2e/
```

## Prior art

Looked at before starting (October 2026): Coracle hides notes under a web-of-trust threshold without saying why; nostui is a terminal client with no spam filtering. Quill's filter takes its rules from the triage in [nostrclaw](https://github.com/rzazo24/nostrclaw).

MIT licensed.
