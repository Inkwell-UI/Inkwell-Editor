import type { Node } from '@inkwell-ui/spec'
import { issue, type LintIssue } from '../../shared/swfLint'

type Shape = Extract<Node, { type: 'shape' }>
type Fill = Shape['fills'][number]

const num = (n: number): string => String(Math.round(n * 1000) / 1000)
const hex = (c: { r: number; g: number; b: number }): string =>
  '#' + [c.r, c.g, c.b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')

/** Cubic path kept cubic: FFDec's SVG importer does the quadratic approximation. All subpaths in one `d` (even-odd, as SWF fills are). */
export function pathData(paths: Shape['paths']): string {
  return paths
    .flat()
    .map((c) => {
      switch (c.op) {
        case 'M':
        case 'L':
          return `${c.op}${num(c.x)} ${num(c.y)}`
        case 'C':
          return `C${num(c.x1)} ${num(c.y1)} ${num(c.x2)} ${num(c.y2)} ${num(c.x)} ${num(c.y)}`
        case 'Z':
          return 'Z'
      }
    })
    .join(' ')
}

/** Solid colour of a fill, or undefined when it cannot be drawn (reported in `lint`). Gradients fall back to their first stop. */
function solid(f: Fill, nodeId: string, lint: LintIssue[]): { color: string; opacity: number } | undefined {
  if (f.type === 'solid') return { color: hex(f.color), opacity: (f.color.a ?? 1) * (f.opacity ?? 1) }
  if (f.type === 'image') {
    lint.push(issue('warning', 'fill-unsupported', nodeId, 'Image fills compile only on rectangles without a stroke (image layers) and on frames; this fill is skipped.'))
    return undefined
  }
  const s = f.stops[0]
  lint.push(issue('warning', 'fill-gradient-approximated', nodeId, `${f.type} gradients are not supported yet; drawn as the first stop colour.`))
  return s ? { color: hex(s.color), opacity: s.color.a ?? 1 } : undefined
}

/** A frame's solid or gradient fill (first stop) as a w x h rectangle SVG, or undefined when it cannot be drawn. */
export function rectSvg(w: number, h: number, f: Fill, nodeId: string, lint: LintIssue[]): string | undefined {
  const s = solid(f, nodeId, lint)
  if (!s) return undefined
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w)}" height="${num(h)}" viewBox="0 0 ${num(w)} ${num(h)}"><rect width="${num(w)}" height="${num(h)}" fill="${s.color}" fill-opacity="${num(s.opacity)}"/></svg>\n`
}

/** The four sides of a border as filled rects inside w x h; a side of weight 0 is left out. */
function sideBars(w: number, h: number, { top, right, bottom, left }: { top: number; right: number; bottom: number; left: number }, s: { color: string; opacity: number }): string[] {
  const rect = (x: number, y: number, rw: number, rh: number): string[] =>
    rw > 0 && rh > 0 ? [`<rect x="${num(x)}" y="${num(y)}" width="${num(rw)}" height="${num(rh)}" fill="${s.color}" fill-opacity="${num(s.opacity)}"/>`] : []
  return [...rect(0, 0, w, top), ...rect(0, h - bottom, w, bottom), ...rect(0, top, left, h - top - bottom), ...rect(w - right, top, right, h - top - bottom)]
}

/**
 * A frame's strokes as one w x h SVG of filled side bars, or undefined when nothing can be drawn. Each stroke is a ring (or the single sides of an individual stroke) laid inside the
 * bounds: the SVG cannot draw outside its own box, so a centered or outside stroke is approximated as inside (warning). Left and right bars sit between the top and bottom ones so
 * translucent corners are not drawn twice.
 */
export function frameStrokeSvg(w: number, h: number, strokes: NonNullable<Extract<Node, { type: 'frame' }>['strokes']>, nodeId: string, lint: LintIssue[]): string | undefined {
  const bars: string[] = []
  for (const st of strokes) {
    if (st.alignment !== 'inside') lint.push(issue('warning', 'stroke-alignment-approximated', nodeId, `Frame strokes are drawn inside the frame; the ${st.alignment} stroke is drawn inside.`))
    const s = solid(st.fill, nodeId, lint)
    if (!s) continue
    bars.push(...sideBars(w, h, st.sides ?? { top: st.weight, right: st.weight, bottom: st.weight, left: st.weight }, s))
  }
  return bars.length ? `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w)}" height="${num(h)}" viewBox="0 0 ${num(w)} ${num(h)}">${bars.join('')}</svg>\n` : undefined
}

/** The clip layer of a frame with clipContent: any opaque fill works, only the shape of the area matters. */
export const maskSvg = (w: number, h: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w)}" height="${num(h)}" viewBox="0 0 ${num(w)} ${num(h)}"><rect width="${num(w)}" height="${num(h)}" fill="#000000"/></svg>
`

/** One SVG for one Shape node, in the node's local space (viewBox 0 0 width height); FFDec places 1 px = 20 twips. */
export function shapeToSvg(node: Shape): { svg?: string; lint: LintIssue[] } {
  const lint: LintIssue[] = []
  const d = pathData(node.paths)
  if (node.paths.flat().some((c) => c.op === 'C')) {
    lint.push(issue('warning', 'curve-approximated', node.id, 'Cubic curves are approximated by SWF quadratic curves.'))
  }
  const layers: string[] = []
  for (const f of node.fills) {
    const s = solid(f, node.id, lint)
    if (s) layers.push(`<path d="${d}" fill="${s.color}" fill-opacity="${num(s.opacity)}" fill-rule="evenodd"/>`)
  }
  for (const st of node.strokes) {
    if (st.alignment !== 'center') {
      lint.push(issue('warning', 'stroke-alignment-approximated', node.id, `SWF strokes are centered; the ${st.alignment} stroke is drawn centered.`))
    }
    const s = solid(st.fill, node.id, lint)
    // individual strokes only exist on rectangles, so the bars of the bounding box are the stroke
    if (s && st.sides) layers.push(...sideBars(node.transform.width, node.transform.height, st.sides, s))
    else if (s) layers.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-opacity="${num(s.opacity)}" stroke-width="${num(st.weight)}"/>`)
  }
  if (!layers.length) {
    lint.push(issue('info', 'shape-empty', node.id, 'Shape has no drawable fill or stroke; skipped.'))
    return { lint }
  }
  const { width: w, height: h } = node.transform
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w)}" height="${num(h)}" viewBox="0 0 ${num(w)} ${num(h)}">${layers.join('')}</svg>\n`
  return { svg, lint }
}
