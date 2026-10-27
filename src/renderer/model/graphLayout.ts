import type { FlowEdge, FlowNode } from '../state/graphStore'

const GAP_X = 80
const GAP_Y = 40
const BLOCK_GAP = 80 // between unconnected parts of the graph
const SWEEPS = 3
const FALLBACK = { w: 220, h: 100 } // before a node has been measured

/** Pool-adjacent-violators: the non-decreasing sequence closest (least squares) to `r`. */
function isotonic(r: readonly number[]): number[] {
  const blocks: { sum: number; n: number }[] = []
  for (const v of r) {
    blocks.push({ sum: v, n: 1 })
    while (blocks.length > 1 && blocks[blocks.length - 1]!.sum / blocks[blocks.length - 1]!.n < blocks[blocks.length - 2]!.sum / blocks[blocks.length - 2]!.n) {
      const last = blocks.pop()!
      const prev = blocks[blocks.length - 1]!
      prev.sum += last.sum
      prev.n += last.n
    }
  }
  return blocks.flatMap((b) => Array<number>(b.n).fill(b.sum / b.n))
}

/**
 * Tidy Layout, left to right:
 * - every unconnected part of the graph is laid out on its own and the parts are stacked top to bottom (nodes with no wire at all go last, in one column);
 * - columns are the longest path along the wires; a node with no input whose outputs are all data (Get Variable, a constant) sits right before its first
 *   consumer instead of in the first column; `isExec` says which wires are exec, an event with an exec output stays in the first column;
 * - inside a column the nodes an exec wire touches (the spine) are ordered and placed by the height of their neighbours (sweeps left to right on the sources, right to
 *   left on the targets), so a chain runs straight and a node sits between its children; data-only nodes then take the nearest free spot beside their consumer.
 * Pure: returns new positions for every node, anchored at the top-left of the current bounding box so the graph stays where the user was looking.
 */
export function tidyPositions(nodes: readonly FlowNode[], edges: readonly FlowEdge[], isExec: (e: FlowEdge) => boolean = () => false): Record<string, { x: number; y: number }> {
  if (!nodes.length) return {}
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const into = new Map<string, Set<string>>()
  const outOf = new Map<string, Set<string>>()
  const execSource = new Set<string>()
  const execNode = new Set<string>() // either end of an exec wire
  const link = (m: Map<string, Set<string>>, a: string, b: string): void => void m.set(a, (m.get(a) ?? new Set()).add(b))
  for (const e of edges) {
    if (e.source === e.target || !byId.has(e.source) || !byId.has(e.target)) continue
    link(into, e.target, e.source)
    link(outOf, e.source, e.target)
    if (isExec(e)) (execSource.add(e.source), execNode.add(e.source), execNode.add(e.target))
  }
  const near = (id: string): string[] => [...(into.get(id) ?? []), ...(outOf.get(id) ?? [])]

  const size = (n: FlowNode): { w: number; h: number } => ({ w: n.measured?.width ?? FALLBACK.w, h: n.measured?.height ?? FALLBACK.h })
  const order = [...nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x) // stable start: today's top-to-bottom order
  const rank = new Map(order.map((n, i) => [n.id, i]))
  const x0 = Math.min(...nodes.map((n) => n.position.x))
  const y0 = Math.min(...nodes.map((n) => n.position.y))

  // the unconnected parts, in today's top-to-bottom order; wireless nodes are collected apart
  const seen = new Set<string>()
  const parts: FlowNode[][] = []
  const loose: FlowNode[] = []
  for (const n of order) {
    if (seen.has(n.id)) continue
    const part: FlowNode[] = []
    const stack = [n.id]
    seen.add(n.id)
    while (stack.length) {
      const id = stack.pop()!
      part.push(byId.get(id)!)
      for (const m of near(id)) if (!seen.has(m)) (seen.add(m), stack.push(m))
    }
    if (part.length === 1 && near(n.id).length === 0) loose.push(n)
    else parts.push(part.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!))
  }

  const out: Record<string, { x: number; y: number }> = {}

  /** Lays one connected part out with its top-left at (x, top); returns its bottom. */
  const layoutPart = (part: FlowNode[], x: number, top: number): number => {
    const layer = new Map<string, number>()
    const walking = new Set<string>()
    const depth = (id: string): number => {
      const known = layer.get(id)
      if (known !== undefined) return known
      if (walking.has(id)) return 0 // cycle: stop here
      walking.add(id)
      const d = Math.max(-1, ...[...(into.get(id) ?? [])].map(depth)) + 1
      walking.delete(id)
      layer.set(id, d)
      return d
    }
    part.forEach((n) => depth(n.id))
    // a data source goes right before its first consumer (its targets have a source, so they are in layer 1 or later)
    for (const n of part) {
      const to = [...(outOf.get(n.id) ?? [])]
      if (!into.get(n.id)?.size && to.length && !execSource.has(n.id)) layer.set(n.id, Math.min(...to.map((t) => layer.get(t)!)) - 1)
    }
    const columns: FlowNode[][] = []
    for (const n of part) (columns[layer.get(n.id)!] ??= []).push(n)
    const cols = columns.filter((c): c is FlowNode[] => !!c)

    // the spine is what an exec wire touches: it sets the rows. Data-only nodes hang beside it afterwards (a graph without exec wires is all spine).
    const touched = part.filter((n) => execNode.has(n.id))
    const spine = new Set((touched.length ? touched : part).map((n) => n.id))

    const cy = new Map<string, number>() // vertical centre
    for (const col of cols) {
      let t = 0
      for (const n of col.filter((m) => spine.has(m.id))) (cy.set(n.id, t + size(n).h / 2), (t += size(n).h + GAP_Y))
    }
    /** Spine nodes of a column go where their neighbours (in `use`) are: the closest rows that do not overlap, in neighbour order (isotonic regression). */
    const place = (col: FlowNode[], use: Map<string, Set<string>>): void => {
      const mine = col.filter((n) => spine.has(n.id))
      const want = new Map(
        mine.map((n) => {
          const ys = [...(use.get(n.id) ?? [])].filter((m) => spine.has(m) && cy.has(m)).map((m) => cy.get(m)!)
          return [n.id, ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : cy.get(n.id)!] as const
        })
      )
      const sorted = mine.sort((a, b) => want.get(a.id)! - want.get(b.id)! || rank.get(a.id)! - rank.get(b.id)!)
      let off = 0
      const r = sorted.map((n) => {
        const v = want.get(n.id)! - size(n).h / 2 - off
        off += size(n).h + GAP_Y
        return v
      })
      const u = isotonic(r)
      off = 0
      sorted.forEach((n, i) => {
        cy.set(n.id, u[i]! + off + size(n).h / 2)
        off += size(n).h + GAP_Y
      })
    }
    for (let i = 0; i < SWEEPS; i++) {
      for (let c = 1; c < cols.length; c++) place(cols[c]!, into)
      for (let c = cols.length - 2; c >= 0; c--) place(cols[c]!, outOf)
    }
    for (let c = 1; c < cols.length; c++) place(cols[c]!, into)

    // data-only nodes, right to left: next to their consumer, on the nearest free spot of their column
    for (let c = cols.length - 1; c >= 0; c--) {
      const col = cols[c]!
      const taken = col.filter((n) => cy.has(n.id)).map((n) => ({ a: cy.get(n.id)! - size(n).h / 2, b: cy.get(n.id)! + size(n).h / 2 }))
      const free = col.filter((n) => !cy.has(n.id)).map((n) => {
        const ys = [...(outOf.get(n.id) ?? [])].filter((m) => cy.has(m)).map((m) => cy.get(m)!)
        return { n, want: ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0 }
      })
      for (const { n, want } of free.sort((p, q) => p.want - q.want || rank.get(p.n.id)! - rank.get(q.n.id)!)) {
        const h = size(n).h
        const clash = (t: number) => taken.find((k) => t < k.b + GAP_Y && t + h + GAP_Y > k.a)
        let down = want - h / 2
        for (let k = clash(down); k; k = clash(down)) down = k.b + GAP_Y
        let up = want - h / 2
        for (let k = clash(up); k; k = clash(up)) up = k.a - GAP_Y - h
        const t = Math.abs(down - (want - h / 2)) <= Math.abs(up - (want - h / 2)) ? down : up // the nearer free spot, above or below
        cy.set(n.id, t + size(n).h / 2)
        taken.push({ a: t, b: t + size(n).h })
      }
    }

    const shift = top - Math.min(...part.map((n) => cy.get(n.id)! - size(n).h / 2))
    let cx = x
    for (const col of cols) {
      for (const n of col) out[n.id] = { x: cx, y: cy.get(n.id)! - size(n).h / 2 + shift }
      cx += Math.max(...col.map((n) => size(n).w)) + GAP_X
    }
    return Math.max(...part.map((n) => cy.get(n.id)! + size(n).h / 2)) + shift
  }

  let top = y0
  for (const part of parts) top = layoutPart(part, x0, top) + BLOCK_GAP
  let y = top
  for (const n of loose) {
    out[n.id] = { x: x0, y }
    y += size(n).h + GAP_Y
  }
  return out
}
