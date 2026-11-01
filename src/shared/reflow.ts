import type { Node, Swf } from '@inkwell-ui/spec'

/** Stage size of an aspect ratio (width / height) at the design height. */
export const stageForAspect = (design: { width: number; height: number }, aspect: number): { width: number; height: number } => ({ width: Math.round(design.height * aspect), height: design.height })

type Mut = Node & { transform: { x: number; y: number; width: number; height: number; rotation: number } }
type Path = Extract<Node, { type: 'shape' }>['paths'][number]
type Frame = Extract<Node, { type: 'frame' }>
type Auto = NonNullable<Frame['autoLayout']>
const scalePaths = (n: Mut, fx: number, fy: number): void => {
  if (n.type !== 'shape') return
  n.paths = n.paths.map((p: Path) => p.map((c) => (c.op === 'Z' ? c : c.op === 'C' ? { ...c, x1: c.x1 * fx, y1: c.y1 * fy, x2: c.x2 * fx, y2: c.y2 * fy, x: c.x * fx, y: c.y * fy } : { ...c, x: c.x * fx, y: c.y * fy })))
}

/** One axis of a child: its new offset and size when its parent grew from `oldP` to `newP`, by its Figma constraint. */
function constrain(kind: string, pos: number, size: number, oldP: number, newP: number): [number, number] {
  const d = newP - oldP
  if (kind === 'right' || kind === 'bottom') return [pos + d, size]
  if (kind === 'center') return [pos + d / 2, size]
  if (kind === 'stretch') return [pos, size + d]
  if (kind === 'scale') return oldP > 0 ? [(pos * newP) / oldP, (size * newP) / oldP] : [pos, size]
  return [pos, size]
}

/**
 * Lays the design out again for another stage size, like Figma resizing the root frame: a child follows its constraint (`anchor`) inside its parent,
 * and an auto-layout frame shares its extra room among its `fill` children and re-flows. The root keeps its position; the input is not changed.
 * shortcut: `hug` frames and text keep their size (no re-measure), wrapping auto layouts are not re-flowed; upgrade when a design needs it.
 */
export function reflowIr(ir: Swf, stage: { width: number; height: number }): Swf {
  if (stage.width === ir.stage.width && stage.height === ir.stage.height) return ir
  const nodes: Record<string, Mut> = Object.fromEntries(Object.entries(ir.nodes).map(([id, n]) => [id, { ...n, transform: { ...n.transform } } as Mut]))

  /** `n` was resized from `old` (its children keep their old box until laid out here). */
  function layoutChildren(n: Mut, old: { width: number; height: number }): void {
    const kids = n.children.map((c) => nodes[c]).filter((c): c is Mut => !!c)
    const { width: w, height: h } = n.transform
    const al: Auto | undefined = n.type === 'frame' ? n.autoLayout : undefined
    const flow = al && !al.wrap ? kids.filter((k) => !k.layout?.absolute) : []
    for (const k of kids) {
      if (flow.includes(k)) continue
      const o = { ...k.transform }
      const [x, width] = constrain(k.anchor.h, o.x, o.width, old.width, w)
      const [y, height] = constrain(k.anchor.v, o.y, o.height, old.height, h)
      resize(k, x, y, width, height)
    }
    if (al && flow.length) flowChildren(n, al, flow)
  }

  function flowChildren(n: Mut, al: Auto, flow: Mut[]): void {
    const horiz = al.mode === 'horizontal'
    const [pt, pr, pb, pl] = al.padding as [number, number, number, number]
    const main = (horiz ? n.transform.width : n.transform.height) - (horiz ? pl + pr : pt + pb)
    const cross = (horiz ? n.transform.height : n.transform.width) - (horiz ? pt + pb : pl + pr)
    const sizing = (k: Mut) => (horiz ? k.layout?.h : k.layout?.v) ?? 'fixed'
    const csizing = (k: Mut) => (horiz ? k.layout?.v : k.layout?.h) ?? 'fixed'
    const fixed = flow.reduce((s, k) => s + (sizing(k) === 'fill' ? 0 : horiz ? k.transform.width : k.transform.height), 0) + al.spacing * (flow.length - 1)
    const fills = flow.filter((k) => sizing(k) === 'fill').length
    const each = fills ? Math.max(0, main - fixed) / fills : 0
    const sizes = flow.map((k) => (sizing(k) === 'fill' ? each : horiz ? k.transform.width : k.transform.height))
    const used = sizes.reduce((s, v) => s + v, 0) + al.spacing * (flow.length - 1)
    const free = Math.max(0, main - used)
    let cursor = (horiz ? pl : pt) + (al.primaryAlign === 'center' ? free / 2 : al.primaryAlign === 'end' ? free : 0)
    const gap = al.primaryAlign === 'spaceBetween' && flow.length > 1 ? al.spacing + free / (flow.length - 1) : al.spacing
    flow.forEach((k, i) => {
      const t = k.transform
      const cs = csizing(k) === 'fill' ? cross : horiz ? t.height : t.width
      const co = (horiz ? pt : pl) + (al.counterAlign === 'center' ? (cross - cs) / 2 : al.counterAlign === 'end' ? cross - cs : 0)
      const [x, y, width, height] = horiz ? [cursor, co, sizes[i]!, cs] : [co, cursor, cs, sizes[i]!]
      resize(k, x, y, width, height)
      cursor += sizes[i]! + gap
    })
  }

  function resize(k: Mut, x: number, y: number, width: number, height: number): void {
    const old = { width: k.transform.width, height: k.transform.height }
    k.transform.x = x
    k.transform.y = y
    k.transform.width = width
    k.transform.height = height
    if (old.width === width && old.height === height) return
    scalePaths(k, old.width > 0 ? width / old.width : 1, old.height > 0 ? height / old.height : 1)
    layoutChildren(k, old)
  }

  const root = nodes[ir.root]
  if (!root) return ir
  const old = { width: root.transform.width, height: root.transform.height }
  root.transform.width = stage.width
  root.transform.height = stage.height
  layoutChildren(root, old)
  return { ...ir, stage: { ...ir.stage, ...stage }, nodes: nodes as unknown as Swf['nodes'] }
}
