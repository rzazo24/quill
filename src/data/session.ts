// Everything the filter needs to know about the reader: who they follow, the graph around them, what they muted.
import type { Context } from '../core/verdict.js'
import { buildGraph, type GraphInfo } from './graph.js'
import { followsOf, mutesOf, newestPerAuthor } from './lists.js'
import { queryAuthors, type Fetcher } from '../net/fetcher.js'

/** Most follow lists fetched for the graph: bounds the work for people who follow thousands. */
export const MAX_GRAPH_FOLLOWS = 500

export interface Session {
  me: string
  follows: Set<string>
  muted: Set<string>
  mutedWords: string[]
  graphInfo: GraphInfo
}

export async function loadSession(f: Fetcher, me: string): Promise<Session> {
  const own = await f.query({ kinds: [3, 10000], authors: [me], limit: 10 })
  const newest = (kind: number) => newestPerAuthor(own.filter((e) => e.kind === kind)).get(me)
  const followList = newest(3), muteList = newest(10000)
  const follows = new Set(followList ? followsOf(followList) : [])
  const mutes = muteList ? mutesOf(muteList) : { pubkeys: [], words: [] }
  const graphOwners = [...follows].slice(0, MAX_GRAPH_FOLLOWS)
  const lists = new Map<string, string[]>()
  for (const [owner, e] of newestPerAuthor(await queryAuthors(f, { kinds: [3], limit: 200 }, graphOwners))) lists.set(owner, followsOf(e))
  const graphInfo = buildGraph(me, follows, lists, graphOwners.length)
  return { me, follows, muted: new Set(mutes.pubkeys), mutedWords: mutes.words, graphInfo }
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
