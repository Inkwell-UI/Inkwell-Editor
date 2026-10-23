import type { Node } from '@inkwell-ui/spec'
import { issue, type LintIssue } from './lint'

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
    if (s) layers.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-opacity="${num(s.opacity)}" stroke-width="${num(st.weight)}"/>`)
  }
  if (!layers.length) {
    lint.push(issue('info', 'shape-empty', node.id, 'Shape has no drawable fill or stroke; skipped.'))
    return { lint }
  }
  const { width: w, height: h } = node.transform
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w)}" height="${num(h)}" viewBox="0 0 ${num(w)} ${num(h)}">${layers.join('')}</svg>\n`
  return { svg, lint }
}
