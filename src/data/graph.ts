// The follow graph around you, two hops deep: you (0), the people you follow (1), the people they follow (2).
import type { Graph } from '../core/verdict.js'

export interface GraphInfo {
  graph: Graph
  /** How many of your follows' lists arrived, out of how many you follow. */
  answered: number
  total: number
  /** The follow lists that arrived (owner -> who they follow): who follows whom, kept for the "Network" view. */
  lists: ReadonlyMap<string, readonly string[]>
}

/**
 * `expected` is how many lists were asked for (fewer than `follows` when the graph is capped). `lists` holds the follow list of each person you follow that could be fetched. If fewer than half arrived, the graph is NOT marked
 * loaded: "nobody I can see is connected to them" would only mean the lists are missing, and missing data hides nothing.
 */
export function buildGraph(me: string, follows: ReadonlySet<string>, lists: ReadonlyMap<string, readonly string[]>, expected = follows.size): GraphInfo {
  const dist = new Map<string, number>([[me, 0]])
  for (const f of follows) dist.set(f, 1)
  for (const [owner, list] of lists) {
    if (!follows.has(owner)) continue
    for (const p of list) if (!dist.has(p)) dist.set(p, 2)
  }
  const answered = [...lists.keys()].filter((k) => follows.has(k)).length
  const loaded = expected > 0 && answered >= expected * 0.5
  return { graph: { loaded, distance: (pk) => dist.get(pk) ?? null }, answered, total: expected, lists }
}
