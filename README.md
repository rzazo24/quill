# Quill

A tiny **text-only** Nostr client that **tells you why it hides things**.

> Status: early. The core (safe text, threads, the filter) is done and tested; the interface is next.

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

## Develop

```bash
npm install
npm test        # unit tests of the core
npm run build   # type-check + production build
npm run dev
```

## Prior art

Looked at before starting (October 2026): Coracle hides notes under a web-of-trust threshold without saying why; nostui is a terminal client with no spam filtering. Quill's filter takes its rules from the triage in [nostrclaw](https://github.com/rzazo24/nostrclaw).

MIT licensed.
