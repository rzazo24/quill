// The three views: people you follow, notes that mention you, and a thread. Each one loads, filters and returns judged notes.
import type { Event } from 'nostr-tools'
import { isReply, threadRefs } from '../core/thread.js'
import { analyse, judge, judgeAll, type Context, type Judged, type Settings, DEFAULT_SETTINGS } from '../core/verdict.js'
import { newestPerAuthor, nameOf } from './lists.js'
import { queryAuthors, type Fetcher } from '../net/fetcher.js'

export const FEED_LIMIT = 100
const byNewest = (a: Event, b: Event) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1)

/** Root notes (not replies) of the people you follow and of you, newest first. */
export async function loadFollowing(f: Fetcher, ctx: Context, settings: Settings = DEFAULT_SETTINGS): Promise<Judged[]> {
  const authors = [...new Set([ctx.me, ...ctx.follows])]
  const events = await queryAuthors(f, { kinds: [1], limit: FEED_LIMIT }, authors)
  const roots = events.filter((e) => !isReply(e)).sort(byNewest).slice(0, FEED_LIMIT)
  return judgeAll(roots, ctx, settings)
}

/** Notes that tag you (replies and mentions) from anyone: this is where the filter has work to do. */
export async function loadMentions(f: Fetcher, ctx: Context, settings: Settings = DEFAULT_SETTINGS): Promise<Judged[]> {
  const events = (await f.query({ kinds: [1], '#p': [ctx.me], limit: FEED_LIMIT })).filter((e) => e.pubkey !== ctx.me).sort(byNewest)
  return judgeAll(events, ctx, settings)
}

export interface ThreadNode { item: Judged; children: ThreadNode[] }
export interface Thread { root: Judged | null; rootId: string; replies: ThreadNode[]; total: number }

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
export async function loadThread(f: Fetcher, id: string, ctx: Context, settings: Settings = DEFAULT_SETTINGS): Promise<Thread | null> {
  const [first] = await f.query({ ids: [id], kinds: [1], limit: 1 })
  if (!first) return null
  const rootId = threadRefs(first).root ?? first.id
  const rootEvent = rootId === first.id ? first : (await f.query({ ids: [rootId], kinds: [1], limit: 1 }))[0]
  const replies = (await f.query({ kinds: [1], '#e': [rootId], limit: 300 })).filter((e) => e.id !== rootId)
  const pool = [...replies, ...(rootEvent ? [rootEvent] : [])]
  const signals = analyse(pool)
  const judged = replies.map((event) => ({ event, verdict: judge(event, ctx, signals, settings) }))
  return {
    rootId,
    root: rootEvent ? { event: rootEvent, verdict: judge(rootEvent, ctx, signals, settings) } : null,
    replies: buildTree(rootId, judged),
    total: judged.length,
  }
}

/** Display names for the keys on screen. Missing profiles simply have no name. */
export async function loadNames(f: Fetcher, pubkeys: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unique = [...new Set(pubkeys)]
  for (const [pk, e] of newestPerAuthor(await queryAuthors(f, { kinds: [0], limit: 200 }, unique))) {
    const n = nameOf(e)
    if (n) out.set(pk, n)
  }
  return out
}
