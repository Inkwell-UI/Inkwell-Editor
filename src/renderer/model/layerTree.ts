import type { Swf } from '@inkwell-ui/spec'
import type { OverlayDoc } from '../../shared/overlay'
import type { LintRow } from '../../shared/syncState'

/** Per-row badges of the Navigator (UX 4.2). Lint badges come from the single lint source; the others from the overlay and the IR text. */
export type BadgeKind = 'error' | 'warning' | 'placeholder' | 'script' | 'link' | 'pad'
export interface Badge {
  kind: BadgeKind
  /** Number of issues for error/warning. */
  count?: number
}

export interface LayerNode {
  id: string
  name: string
  type: string
  /** Overlay role, if set (searchable). */
  role?: string
  badges: Badge[]
  children: LayerNode[]
}

export interface LayerRow extends Omit<LayerNode, 'children'> {
  /** A component instance a graph made while the preview runs: not a layer of the design, gone with the next build. */
  runtime?: boolean
  depth: number
  hasChildren: boolean
  expanded: boolean
}

/** Lint rows of one SWF by node id -> counts per severity (info is not a badge). */
export function lintCounts(lint: readonly Pick<LintRow, 'nodeId' | 'severity'>[]): Map<string, { error: number; warning: number }> {
  const m = new Map<string, { error: number; warning: number }>()
  for (const l of lint) {
    if (l.severity === 'info') continue
    const c = m.get(l.nodeId) ?? { error: 0, warning: 0 }
    c[l.severity]++
    m.set(l.nodeId, c)
  }
  return m
}

/** `$` badge only when a text node's content is a translation key placeholder (starts with `$`). */
export const isPlaceholderText = (content: string): boolean => content.startsWith('$')

/**
 * The LAYERS tree of one SWF: root frame down, children in IR order. A node reached twice (bad IR) or missing is skipped, so the walk
 * always ends. Nodes no root reaches are not in the tree (the unreachable section handles them).
 */
export function buildLayerTree(ir: Swf, overlay: OverlayDoc | undefined, lint: readonly Pick<LintRow, 'nodeId' | 'severity'>[]): LayerNode | undefined {
  const counts = lintCounts(lint)
  const seen = new Set<string>()
  const walk = (id: string): LayerNode | undefined => {
    const n = ir.nodes[id]
    if (!n || seen.has(id)) return undefined
    seen.add(id)
    const o = overlay?.nodes?.[id] as { role?: unknown; scripts?: unknown; dataBinding?: unknown; focus?: unknown } | undefined
    const c = counts.get(id)
    const badges: Badge[] = []
    if (c?.error) badges.push({ kind: 'error', count: c.error })
    if (c?.warning) badges.push({ kind: 'warning', count: c.warning })
    if (n.type === 'text' && isPlaceholderText(n.content)) badges.push({ kind: 'placeholder' })
    if (Array.isArray(o?.scripts) && o.scripts.length) badges.push({ kind: 'script' })
    if (typeof o?.dataBinding === 'string' && o.dataBinding) badges.push({ kind: 'link' })
    if (o?.focus && typeof o.focus === 'object' && Object.keys(o.focus).length) badges.push({ kind: 'pad' })
    return {
      id,
      name: n.name,
      type: n.type,
      ...(typeof o?.role === 'string' ? { role: o.role } : {}),
      badges,
      children: n.children.flatMap((k) => walk(k) ?? [])
    }
  }
  return walk(ir.root)
}

/** Keeps nodes whose name, role or type contains the query (case-insensitive) and the ancestors leading to them. Empty query keeps all. */
export function filterTree(root: LayerNode, query: string): LayerNode | undefined {
  const q = query.trim().toLowerCase()
  if (!q) return root
  const go = (n: LayerNode): LayerNode | undefined => {
    const kids = n.children.flatMap((c) => go(c) ?? [])
    const hit = n.name.toLowerCase().includes(q) || (n.role ?? '').toLowerCase().includes(q) || n.type.toLowerCase().includes(q)
    return hit || kids.length ? { ...n, children: kids } : undefined
  }
  return go(root)
}

/** Visible rows in tree order. While filtering, everything on a matching path is expanded; otherwise `collapsed` ids hide their children. */
/**
 * Puts the instances a graph made (Create Component, seen in the preview) under the layer they were added to, after its own children. A parent that is collapsed, filtered out or not in this
 * SWF shows none of them (a layer that has them is expandable, like one with layers inside). They are rows of their own (`runtime`), named like their component.
 */
/** The row id (and selection id) of a component instance a graph made: its clip path under a prefix no Figma id has. */
export const runtimeRowId = (clipPath: string): string => `runtime:${clipPath}`

export function withRuntimeRows(rows: readonly LayerRow[], spawned: readonly { parent: string; component: string; path: string }[], nameOf: (componentId: string) => string): LayerRow[] {
  const out = [...rows]
  for (const parent of rows) {
    const mine = spawned.filter((s) => s.parent === parent.id)
    if (!mine.length) continue
    // they are the layer's children: it gets a twisty of its own, and collapsing it hides them
    const i = out.indexOf(parent)
    out[i] = { ...parent, hasChildren: true }
    if (!parent.expanded) continue
    let at = i + 1
    while (at < out.length && out[at]!.depth > parent.depth) at++
    out.splice(at, 0, ...mine.map((s) => ({ id: runtimeRowId(s.path), name: nameOf(s.component), type: 'runtime', badges: [], depth: parent.depth + 1, hasChildren: false, expanded: false, runtime: true }) as LayerRow))
  }
  return out
}

export function flattenTree(root: LayerNode, collapsed: ReadonlySet<string>, filtering = false): LayerRow[] {
  const rows: LayerRow[] = []
  const go = (n: LayerNode, depth: number): void => {
    const expanded = filtering || !collapsed.has(n.id)
    const { children, ...rest } = n
    rows.push({ ...rest, depth, hasChildren: children.length > 0, expanded })
    if (expanded) children.forEach((c) => go(c, depth + 1))
  }
  go(root, 0)
  return rows
}
