// The three views: people you follow, notes that mention you, and a thread. Each one loads, filters and returns judged notes.
import type { Event } from 'nostr-tools'
import { COMMENT_KIND } from '../core/thread.js'
import { isReply, threadRefs } from '../core/thread.js'
import { analyse, judge, judgeAll, type Context, type Judged, type Settings, DEFAULT_SETTINGS } from '../core/verdict.js'
import { newestPerAuthor, nameOf, pictureOf } from './lists.js'
import { queryAuthors, type Fetcher } from '../net/fetcher.js'
import { fetchOriginals, loadRepostRefs, mergeFeed } from './reposts.js'
import { fromOutbox, repliesFromInbox, withinPatience } from './outbox.js'

export const FEED_LIMIT = 100
const byNewest = (a: Event, b: Event) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1)

/** Root notes (not replies) of the people you follow and of you, newest first; with `reposts`, also what they reposted (each note once, marked with who reposted it).
 *  A reposted note is judged by the filter like any other, by ITS author: a repost does not vouch for it. */
/** `outbox`: the reader's relays; when given, people who write only elsewhere are also read where they write (see outbox.ts). What arrives from
 *  there after the reader's relays (plus a moment) goes to `onLate`; the page keeps it and hands it back as `arrived` when it draws again. */
export async function loadFollowing(f: Fetcher, ctx: Context, settings: Settings = DEFAULT_SETTINGS, opts: { reposts?: boolean; outbox?: string[]; onLate?: (events: Event[]) => void; arrived?: () => Event[] } = {}): Promise<Judged[]> {
  const authors = [...new Set([ctx.me, ...ctx.follows])]
  const reposted = opts.reposts ? loadRepostRefs(f, authors, FEED_LIMIT).catch(() => []) : null // asked at the same time as the notes: they do not depend on each other
  const ownQ = queryAuthors(f, { kinds: [1], limit: FEED_LIMIT }, authors)
  const [own, elsewhere] = opts.outbox ? await withinPatience(ownQ, fromOutbox(f, { kinds: [1], limit: FEED_LIMIT }, [...ctx.follows], opts.outbox), undefined, opts.onLate) : [await ownQ, [] as Event[]]
  const seen = new Set<string>()
  const events = [...own, ...elsewhere, ...(opts.arrived?.() ?? [])].filter((e) => !seen.has(e.id) && seen.add(e.id) && e.kind === 1 && authors.includes(e.pubkey))
  const roots = events.filter((e) => !isReply(e)).sort(byNewest).slice(0, FEED_LIMIT)
  if (!reposted) return judgeAll(roots, ctx, settings)
  const refs = (await reposted).filter((r) => !ctx.muted.has(r.reposter))
  const items = mergeFeed(roots, refs, await fetchOriginals(f, refs).catch(() => new Map()), FEED_LIMIT)
  const by = new Map(items.map((i) => [i.event.id, i.repostedBy]))
  return judgeAll(items.map((i) => i.event), ctx, settings).map((j) => ({ ...j, ...(by.get(j.event.id)?.length ? { repostedBy: by.get(j.event.id)! } : {}) }))
}

/** Notes that tag you (replies and mentions) from anyone: this is where the filter has work to do. */
export async function loadMentions(f: Fetcher, ctx: Context, settings: Settings = DEFAULT_SETTINGS): Promise<Judged[]> {
  const events = (await f.query({ kinds: [1, COMMENT_KIND], '#p': [ctx.me], limit: FEED_LIMIT })).filter((e) => e.pubkey !== ctx.me).sort(byNewest)
  return judgeAll(events, ctx, settings)
}

/** Everything the reader has written: notes and replies, newest first. */
export async function loadMine(f: Fetcher, ctx: Context, settings: Settings = DEFAULT_SETTINGS): Promise<Judged[]> {
  const events = (await f.query({ kinds: [1], authors: [ctx.me], limit: FEED_LIMIT })).sort(byNewest)
  return judgeAll(events, ctx, settings)
}

export interface ThreadNode { item: Judged; children: ThreadNode[] }
export interface Thread { root: Judged | null; rootId: string; replies: ThreadNode[]; total: number; /** Of those, found only on relays of the note's author that are not the reader's. */ elsewhere: number }

/** Builds the reply tree. A reply whose parent is missing hangs from the root: it is not lost. Oldest first. */
export function buildTree(rootId: string, replies: Judged[]): ThreadNode[] {
  const nodes = new Map<string, ThreadNode>(replies.map((j) => [j.event.id, { item: j, children: [] }]))
  const top: ThreadNode[] = []
  for (const j of [...replies].sort((a, b) => a.event.created_at - b.event.created_at || (a.event.id < b.event.id ? -1 : 1))) {
    const parent = threadRefs(j.event).reply
    const node = nodes.get(j.event.id)!
    const up = parent && parent !== j.event.id && parent !== rootId ? nodes.get(parent) : undefined
    if (up && !createsCycle(nodes, up, j.event.id)) up.children.push(node)
    else top.push(node)
  }
  return top
}

function createsCycle(nodes: Map<string, ThreadNode>, from: ThreadNode, id: string): boolean {
  let n: ThreadNode | undefined = from
  for (let i = 0; n && i < 1000; i++) {
    if (n.item.event.id === id) return true
    const parent: string | undefined = threadRefs(n.item.event).reply
    n = parent ? nodes.get(parent) : undefined
  }
  return false
}

/** A thread from any of its notes: finds the root, fetches the replies, judges all of them together. */
/** `inbox`: also look for replies on the relays where the note's author reads (replies are sent there), given the reader's relays; waits at most `patience` ms for them. */
export async function loadThread(f: Fetcher, id: string, ctx: Context, settings: Settings = DEFAULT_SETTINGS, inbox?: { mine: string[]; patience?: number }): Promise<Thread | null> {
  const [first] = await f.query({ ids: [id], kinds: [1, COMMENT_KIND], limit: 1 })
  if (!first) return null
  const rootId = threadRefs(first).root ?? first.id
  const rootEvent = rootId === first.id ? first : (await f.query({ ids: [rootId], kinds: [1], limit: 1 }))[0]
  // replies (kind 1) and NIP-22 comments (kind 1111) name the root in a lower-case e tag; a comment further down names it in an upper-case E
  const away = inbox && rootEvent ? withinPatience(Promise.resolve(null), repliesFromInbox(f, rootId, rootEvent.pubkey, inbox.mine), inbox.patience ?? 1500).then(([, e]) => e) : Promise.resolve([] as Event[])
  const [direct, comments, far] = await Promise.all([f.query({ kinds: [1, COMMENT_KIND], '#e': [rootId], limit: 300 }), f.query({ kinds: [COMMENT_KIND], '#E': [rootId], limit: 300 }), away])
  const seenIds = new Set<string>()
  const replies = [...direct, ...comments].filter((e) => e.id !== rootId && !seenIds.has(e.id) && seenIds.add(e.id) && threadRefs(e).root === rootId)
  const fromAway = far.filter((e) => e.id !== rootId && !seenIds.has(e.id) && seenIds.add(e.id) && threadRefs(e).root === rootId)
  replies.push(...fromAway)
  // some apps start a new "root" at the reply they answer (its replies name it, not the real root): those branches are asked for too, by the notes
  // of the thread (the one opened included), and kept when their root is one of them; buildTree then hangs each under its parent
  const inThread = new Set([rootId, first.id, ...replies.map((e) => e.id)])
  const subRoots = [...inThread].filter((i) => i !== rootId).slice(0, 100)
  if (subRoots.length) {
    const more = await Promise.all([0, 50].filter((i) => i < subRoots.length).map((i) => f.query({ kinds: [1, COMMENT_KIND], '#e': subRoots.slice(i, i + 50), limit: 300 }).catch(() => [] as Event[])))
    for (const e of more.flat()) {
      const root = threadRefs(e).root
      if (e.id === rootId || seenIds.has(e.id) || !root || root === rootId || !inThread.has(root)) continue
      seenIds.add(e.id); replies.push(e)
    }
  }
  const pool = [...replies, ...(rootEvent ? [rootEvent] : [])]
  const signals = analyse(pool)
  const judged = replies.map((event) => ({ event, verdict: judge(event, ctx, signals, settings) }))
  return {
    rootId,
    root: rootEvent ? { event: rootEvent, verdict: judge(rootEvent, ctx, signals, settings) } : null,
    replies: buildTree(rootId, judged),
    total: judged.length,
    elsewhere: fromAway.length,
  }
}

/** One note, judged on its own (for "quoted from this note"). Null when no relay has it. */
export async function loadNote(f: Fetcher, id: string, ctx: Context, settings: Settings = DEFAULT_SETTINGS): Promise<Judged | null> {
  const [event] = await f.query({ ids: [id], kinds: [1, COMMENT_KIND], limit: 1 })
  return event ? { event, verdict: judge(event, ctx, analyse([event]), settings) } : null
}

/** Display names for the keys on screen. Missing profiles simply have no name. */
/** `pictures`, when given, is filled too with each profile's picture address (the same events: no extra question). */
export async function loadNames(f: Fetcher, pubkeys: string[], pictures?: Map<string, string>): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unique = [...new Set(pubkeys)]
  for (const [pk, e] of newestPerAuthor(await queryAuthors(f, { kinds: [0], limit: 200 }, unique))) {
    const n = nameOf(e)
    if (n) out.set(pk, n)
    const pic = pictures ? pictureOf(e) : undefined
    if (pic) pictures!.set(pk, pic)
  }
  return out
}
