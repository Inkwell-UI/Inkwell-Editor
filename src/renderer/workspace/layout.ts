/**
 * The workspace layout is DATA: a plain JSON-serializable tree saying which panel goes where. Nothing in here knows about React or about the
 * panels themselves (panels are named by registry id), so a layout can be saved, diffed, edited by hand or replaced by a docking library's
 * serialized form behind `Workspace`.
 */
export interface PanelNode {
  kind: 'panel'
  /** Registry id (see panelRegistry.ts). Each id may appear at most once in a layout. */
  panel: string
  /** Share of the parent split along its direction (flex-grow; default 1). */
  size?: number
}
export interface SplitNode {
  kind: 'split'
  /** `row`: children side by side. `column`: children stacked. */
  direction: 'row' | 'column'
  children: LayoutNode[]
  size?: number
}
export type LayoutNode = PanelNode | SplitNode

/** Problems with a layout, empty when it is valid: unknown panel ids, duplicates, empty splits, bad sizes, wrong shapes. */
export function validateLayout(layout: unknown, knownIds: Iterable<string>): string[] {
  const known = new Set(knownIds)
  const seen = new Set<string>()
  const errors: string[] = []
  const walk = (n: unknown, path: string): void => {
    if (typeof n !== 'object' || n === null) return void errors.push(`${path}: not an object`)
    const node = n as Record<string, unknown>
    if (node['size'] !== undefined && !(typeof node['size'] === 'number' && node['size'] > 0 && Number.isFinite(node['size'])))
      errors.push(`${path}: size must be a positive number`)
    if (node['kind'] === 'panel') {
      const id = node['panel']
      if (typeof id !== 'string') errors.push(`${path}: panel id must be a string`)
      else if (!known.has(id)) errors.push(`${path}: unknown panel "${id}"`)
      else if (seen.has(id)) errors.push(`${path}: panel "${id}" appears more than once`)
      else seen.add(id)
    } else if (node['kind'] === 'split') {
      if (node['direction'] !== 'row' && node['direction'] !== 'column') errors.push(`${path}: direction must be "row" or "column"`)
      const kids = node['children']
      if (!Array.isArray(kids) || kids.length === 0) errors.push(`${path}: a split needs at least one child`)
      else kids.forEach((k, i) => walk(k, `${path}.children[${i}]`))
    } else errors.push(`${path}: unknown node kind`)
  }
  walk(layout, 'layout')
  return errors
}

/** Every panel id used in a layout, in tree order (assumes a valid layout). */
export function layoutPanelIds(n: LayoutNode): string[] {
  return n.kind === 'panel' ? [n.panel] : n.children.flatMap(layoutPanelIds)
}

/** The shipped layout: status and connection on the left, the preview large on the right with fonts, lint and timing below. */
export const defaultLayout: LayoutNode = {
  kind: 'split',
  direction: 'row',
  children: [
    {
      kind: 'split',
      direction: 'column',
      size: 1,
      children: [
        { kind: 'panel', panel: 'connection' },
        { kind: 'panel', panel: 'buildStatus' },
        { kind: 'panel', panel: 'timing', size: 2 }
      ]
    },
    {
      kind: 'split',
      direction: 'column',
      size: 3,
      children: [
        { kind: 'panel', panel: 'preview', size: 3 },
        {
          kind: 'split',
          direction: 'row',
          size: 1.2,
          children: [
            { kind: 'panel', panel: 'fonts' },
            { kind: 'panel', panel: 'lint' }
          ]
        }
      ]
    }
  ]
}
