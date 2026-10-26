import type { FlowEdge, FlowNode } from '../state/graphStore'

const GAP_X = 80
const GAP_Y = 40
const FALLBACK = { w: 220, h: 100 } // before a node has been measured

/**
 * Tidy Layout: left-to-right layers by longest path along the wires (a wire's source sits left of its target; cycles are cut where the walk
 * re-enters a node), rows ordered by the average row of their sources, columns stacked top to bottom. Pure: returns new positions for every
 * node, anchored at the top-left of the current bounding box so the graph stays where the user was looking.
 */
export function tidyPositions(nodes: readonly FlowNode[], edges: readonly FlowEdge[]): Record<string, { x: number; y: number }> {
  if (!nodes.length) return {}
  const ids = new Set(nodes.map((n) => n.id))
  const into = new Map<string, string[]>()
  for (const e of edges) {
    if (e.source === e.target || !ids.has(e.source) || !ids.has(e.target)) continue
    into.set(e.target, [...(into.get(e.target) ?? []), e.source])
  }

  const layer = new Map<string, number>()
  const walking = new Set<string>()
  const depth = (id: string): number => {
    const known = layer.get(id)
    if (known !== undefined) return known
    if (walking.has(id)) return 0 // cycle: stop here
    walking.add(id)
    const d = Math.max(-1, ...(into.get(id) ?? []).map(depth)) + 1
    walking.delete(id)
    layer.set(id, d)
    return d
  }
  nodes.forEach((n) => depth(n.id))

  const columns: FlowNode[][] = []
  const sorted = [...nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x) // stable start: today's top-to-bottom order
  for (const n of sorted) (columns[layer.get(n.id)!] ??= []).push(n)

  const row = new Map<string, number>()
  columns.forEach((col) => {
    if (!col) return
    const score = (n: FlowNode): number => {
      const src = (into.get(n.id) ?? []).filter((s) => row.has(s))
      return src.length ? src.reduce((sum, s) => sum + row.get(s)!, 0) / src.length : Infinity
    }
    col.sort((a, b) => score(a) - score(b)) // Array.sort is stable: sourceless nodes keep their order
    col.forEach((n, i) => row.set(n.id, i))
  })

  const size = (n: FlowNode): { w: number; h: number } => ({ w: n.measured?.width ?? FALLBACK.w, h: n.measured?.height ?? FALLBACK.h })
  const x0 = Math.min(...nodes.map((n) => n.position.x))
  const y0 = Math.min(...nodes.map((n) => n.position.y))
  const out: Record<string, { x: number; y: number }> = {}
  let x = x0
  for (const col of columns) {
    if (!col) continue
    let y = y0
    for (const n of col) {
      out[n.id] = { x, y }
      y += size(n).h + GAP_Y
    }
    x += Math.max(...col.map((n) => size(n).w)) + GAP_X
  }
  return out
}
