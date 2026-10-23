import type { Swf } from '@inkwell-ui/spec'

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

const cache = new WeakMap<object, Map<string, Bounds>>()

/**
 * Stage-space axis-aligned bounds of every node the root reaches, from the IR geometry only. Transforms are parent-relative; a node's
 * origin is its top-left, and it rotates about that origin (Figma counterclockwise, drawn as Flash clockwise, as the compiler places it).
 * A rotated node's bounds are the box around its rotated corners. The root frame sits at the stage origin. Cycles and missing children are skipped.
 */
export function computeBounds(ir: Swf): Map<string, Bounds> {
  const hit = cache.get(ir)
  if (hit) return hit
  const out = new Map<string, Bounds>()
  type M = [number, number, number, number, number, number] // a b c d e f: x' = a x + c y + e, y' = b x + d y + f
  const mul = (p: M, q: M): M => [
    p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1],
    p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3],
    p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]
  ]
  const seen = new Set<string>()
  const walk = (id: string, parent: M, isRoot: boolean): void => {
    const n = ir.nodes[id]
    if (!n || seen.has(id)) return
    seen.add(id)
    const { x, y, width, height, rotation } = n.transform
    const a = (-rotation * Math.PI) / 180
    const local: M = isRoot ? [1, 0, 0, 1, 0, 0] : [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), x, y]
    const m = mul(parent, local)
    const xs: number[] = []
    const ys: number[] = []
    for (const [cx, cy] of [[0, 0], [width, 0], [width, height], [0, height]] as const) {
      xs.push(m[0] * cx + m[2] * cy + m[4])
      ys.push(m[1] * cx + m[3] * cy + m[5])
    }
    const x0 = Math.min(...xs)
    const y0 = Math.min(...ys)
    out.set(id, { x: x0, y: y0, width: Math.max(...xs) - x0, height: Math.max(...ys) - y0 })
    for (const c of n.children) walk(c, m, false)
  }
  walk(ir.root, [1, 0, 0, 1, 0, 0], true)
  cache.set(ir, out)
  return out
}

/** Paint order = depth-first, children in IR order (later paints on top). */
function paintOrder(ir: Swf): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const go = (id: string): void => {
    const n = ir.nodes[id]
    if (!n || seen.has(id)) return
    seen.add(id)
    out.push(id)
    n.children.forEach(go)
  }
  go(ir.root)
  return out
}

/** The topmost visible node whose bounds contain the stage-space point; the root frame only when nothing else is hit. */
export function hitTest(ir: Swf, point: { x: number; y: number }): string | undefined {
  const bounds = computeBounds(ir)
  let best: string | undefined
  for (const id of paintOrder(ir)) {
    const n = ir.nodes[id]!
    const b = bounds.get(id)
    if (!b || !n.visible || b.width <= 0 || b.height <= 0) continue
    if (point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height) best = id
  }
  return best
}
