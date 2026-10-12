// Everything the filter needs to know about the reader: who they follow, the graph around them, what they muted.
import type { Context } from '../core/verdict.js'
import { buildGraph, type GraphInfo } from './graph.js'
import { followsOf, mutesOf, newestPerAuthor } from './lists.js'
import { queryAuthors, type Fetcher } from '../net/fetcher.js'

/** Most follow lists fetched for the graph: bounds the work for people who follow thousands. */
export const MAX_GRAPH_FOLLOWS = 500
/** Asked only for follow lists the reader's own relays do not have (purplepag.es keeps profiles and lists for everybody). */
export const LIST_RELAYS = ['wss://purplepag.es']

export interface Session {
  me: string
  follows: Set<string>
  muted: Set<string>
  mutedWords: string[]
  graphInfo: GraphInfo
}

/** The first, cheap part: your own lists. With these the Following feed can already be built (everybody in it is somebody you chose). */
export async function loadOwnLists(f: Fetcher, me: string): Promise<{ follows: Set<string>; muted: Set<string>; mutedWords: string[] }> {
  const own = await f.query({ kinds: [3, 10000], authors: [me], limit: 10 }, { quick: true, grace: 300 }) // a majority of the relays and a moment more: one that hangs must not hold the first screen
  const newest = (kind: number) => newestPerAuthor(own.filter((e) => e.kind === kind)).get(me)
  const followList = newest(3), muteList = newest(10000)
  const mutes = muteList ? mutesOf(muteList) : { pubkeys: [], words: [] }
  return { follows: new Set(followList ? followsOf(followList) : []), muted: new Set(mutes.pubkeys), mutedWords: mutes.words }
}

/** The slow part: the follow lists of the people you follow, hundreds of events whose signatures all have to be checked. */
export async function loadGraphInfo(f: Fetcher, me: string, follows: ReadonlySet<string>): Promise<GraphInfo> {
  const graphOwners = [...follows].slice(0, MAX_GRAPH_FOLLOWS)
  const lists = new Map<string, string[]>()
  for (const [owner, e] of newestPerAuthor(await queryAuthors(f, { kinds: [3], limit: 200 }, graphOwners))) lists.set(owner, followsOf(e))
  // the lists the reader's relays do not have: asked of a relay that keeps profiles, follow lists and relay lists for everybody (nothing else is read there)
  const missing = graphOwners.filter((k) => !lists.has(k))
  if (missing.length) {
    const found = await queryAuthors(f, { kinds: [3], limit: 200 }, missing, 100, { only: LIST_RELAYS, quick: true, grace: 300 }).catch(() => [])
    for (const [owner, e] of newestPerAuthor(found.filter((e) => e.kind === 3 && missing.includes(e.pubkey)))) lists.set(owner, followsOf(e))
  }
  return buildGraph(me, follows, lists, graphOwners.length)
}

/** What the graph says before it is known: nothing is "loaded", so (the principle of the filter) nothing is hidden because of it. */
export const pendingGraph = (me: string, follows: ReadonlySet<string>): GraphInfo => buildGraph(me, follows, new Map(), Math.min(follows.size, MAX_GRAPH_FOLLOWS))

export async function loadSession(f: Fetcher, me: string): Promise<Session> {
  const own = await loadOwnLists(f, me)
  return { me, ...own, graphInfo: await loadGraphInfo(f, me, own.follows) }
}

/** The filter's context: the reader's own mutes plus whatever they added in this app. */
export function contextOf(s: Session, local: { mutedWords: string[]; mutedKeys: string[] } = { mutedWords: [], mutedKeys: [] }): Context {
  return {
    me: s.me,
    follows: s.follows,
    muted: new Set([...s.muted, ...local.mutedKeys]),
    mutedWords: [...new Set([...s.mutedWords, ...local.mutedWords])],
    graph: s.graphInfo.graph,
  }
}
