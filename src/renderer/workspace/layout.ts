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
/** Several panels sharing one slot, shown as tabs (Zone 2 and the bottom dock). */
export interface TabsNode {
  kind: 'tabs'
  tabs: PanelNode[]
  /** Panel id of the tab shown first (default: the first tab). */
  active?: string
  size?: number
}
export type LayoutNode = PanelNode | SplitNode | TabsNode

/** Problems with a layout, empty when it is valid: unknown panel ids, duplicates, empty splits/tabs, bad sizes, wrong shapes. */
export function validateLayout(layout: unknown, knownIds: Iterable<string>): string[] {
  const known = new Set(knownIds)
  const seen = new Set<string>()
  const errors: string[] = []
  const panel = (node: Record<string, unknown>, path: string): void => {
    const id = node['panel']
    if (typeof id !== 'string') errors.push(`${path}: panel id must be a string`)
    else if (!known.has(id)) errors.push(`${path}: unknown panel "${id}"`)
    else if (seen.has(id)) errors.push(`${path}: panel "${id}" appears more than once`)
    else seen.add(id)
  }
  const walk = (n: unknown, path: string, inTabs = false): void => {
    if (typeof n !== 'object' || n === null) return void errors.push(`${path}: not an object`)
    const node = n as Record<string, unknown>
    if (node['size'] !== undefined && !(typeof node['size'] === 'number' && node['size'] > 0 && Number.isFinite(node['size'])))
      errors.push(`${path}: size must be a positive number`)
    if (node['kind'] === 'panel') panel(node, path)
    else if (inTabs) errors.push(`${path}: a tab must be a panel`)
    else if (node['kind'] === 'split') {
      if (node['direction'] !== 'row' && node['direction'] !== 'column') errors.push(`${path}: direction must be "row" or "column"`)
      const kids = node['children']
      if (!Array.isArray(kids) || kids.length === 0) errors.push(`${path}: a split needs at least one child`)
      else kids.forEach((k, i) => walk(k, `${path}.children[${i}]`))
    } else if (node['kind'] === 'tabs') {
      const tabs = node['tabs']
      if (!Array.isArray(tabs) || tabs.length === 0) errors.push(`${path}: tabs needs at least one tab`)
      else {
        tabs.forEach((k, i) => walk(k, `${path}.tabs[${i}]`, true))
        const active = node['active']
        if (active !== undefined && !tabs.some((t) => (t as Record<string, unknown> | null)?.['panel'] === active)) errors.push(`${path}: active tab "${String(active)}" is not one of the tabs`)
      }
    } else errors.push(`${path}: unknown node kind`)
  }
  walk(layout, 'layout')
  return errors
}

/** Every panel id used in a layout, in tree order (assumes a valid layout). */
export function layoutPanelIds(n: LayoutNode): string[] {
  return n.kind === 'panel' ? [n.panel] : n.kind === 'tabs' ? n.tabs.map((t) => t.panel) : n.children.flatMap(layoutPanelIds)
}

/**
 * Identity of a split or tabs node that survives edits elsewhere in the tree: the ids of its children's first panels joined with `|`.
 * Persisted sizes and the active tab are stored under this key (so a user's sizes are not tied to child positions).
 */
export const nodeKey = (n: LayoutNode): string =>
  n.kind === 'panel' ? n.panel : n.kind === 'tabs' ? n.tabs.map((t) => t.panel).join('|') : n.children.map((c) => layoutPanelIds(c)[0] ?? '?').join('|')

/**
 * Removes one panel (e.g. the preview while it is detached into its own window). A split left with one child is replaced by that child
 * (keeping the split's own size), a tab group left with one tab by that panel. Returns undefined if nothing is left.
 */
export function removePanel(n: LayoutNode, id: string): LayoutNode | undefined {
  if (n.kind === 'panel') return n.panel === id ? undefined : n
  if (n.kind === 'tabs') {
    const tabs = n.tabs.filter((t) => t.panel !== id)
    if (!tabs.length) return undefined
    if (tabs.length === 1) return { ...tabs[0]!, ...(n.size !== undefined ? { size: n.size } : {}) }
    const active = n.active && tabs.some((t) => t.panel === n.active) ? n.active : undefined
    return { ...n, tabs, ...(active ? { active } : { active: undefined }) }
  }
  const children = n.children.flatMap((c) => removePanel(c, id) ?? [])
  if (!children.length) return undefined
  if (children.length === 1) return { ...children[0]!, ...(n.size !== undefined ? { size: n.size } : {}) }
  return { ...n, children }
}

/** Per-node overrides a user made: split key -> sizes (one number per child), tabs key -> active panel id. */
export interface LayoutOverrides {
  sizes?: Record<string, number[]>
  tabs?: Record<string, string>
}

/** Applies a user's resized splits and chosen tabs to a layout. Overrides that no longer fit (other child count, unknown tab) are ignored. */
export function applyOverrides(n: LayoutNode, o: LayoutOverrides): LayoutNode {
  if (n.kind === 'panel') return n
  const key = nodeKey(n)
  if (n.kind === 'tabs') {
    const a = o.tabs?.[key]
    return a && n.tabs.some((t) => t.panel === a) ? { ...n, active: a } : n
  }
  const sizes = o.sizes?.[key]
  const fits = sizes?.length === n.children.length && sizes.every((s) => s > 0 && Number.isFinite(s))
  return {
    ...n,
    children: n.children.map((c, i) => {
      const child = applyOverrides(c, o)
      return fits ? { ...child, size: sizes![i]! } : child
    })
  }
}

/** Key (see `nodeKey`) of the tabs node that holds panel `id`, or undefined. */
export function tabsKeyOf(n: LayoutNode, id: string): string | undefined {
  if (n.kind === 'panel') return undefined
  if (n.kind === 'tabs') return n.tabs.some((t) => t.panel === id) ? nodeKey(n) : undefined
  for (const c of n.children) {
    const k = tabsKeyOf(c, id)
    if (k) return k
  }
  return undefined
}
