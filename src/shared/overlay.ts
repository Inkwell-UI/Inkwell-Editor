import { SPEC_VERSION } from '@inkwell-ui/spec'

/** AS2 identifier from free text: invalid characters become `_`, a leading digit gets a `_` prefix. Used for default instance names and generated names. */
export const ident = (s: string): string => {
  const r = s.replace(/[^A-Za-z0-9_]/g, '_')
  return /^[0-9]/.test(r) || r === '' ? '_' + r : r
}

/** An overlay document as stored in `swfs/<name>/overlay.json`. Unknown keys (at any level) are kept, never dropped. */
export type OverlayDoc = Record<string, unknown> & { specVersion?: number; nodes?: Record<string, Record<string, unknown>> }

/** Roles offered by the Inspector (design spec: "button, list, progress, text..."). An existing role outside the list is kept and shown. */
export const ROLES = ['button', 'list', 'progress', 'text', 'image', 'clip'] as const

/** Instance names must already be identifiers (what `ident` would produce). Returns an error id, or undefined when fine. */
export function instanceNameError(name: string): 'empty' | 'invalid' | undefined {
  if (name === '') return 'empty'
  return ident(name) === name ? undefined : 'invalid'
}

/** Old overlays (the sample's `{bindings, nodes, version}`) have no `specVersion`; it is added on the first save, nothing else changes. */
export function normalizeOverlay(raw: Record<string, unknown>): OverlayDoc {
  const nodes = raw['nodes'] && typeof raw['nodes'] === 'object' ? (raw['nodes'] as OverlayDoc['nodes']) : {}
  return { ...raw, specVersion: typeof raw['specVersion'] === 'number' ? raw['specVersion'] : SPEC_VERSION, nodes }
}

/**
 * Placement override of a HUD widget, stored as `anchor` on the widget frame's overlay entry (design spec: anchor overrides live in the overlay).
 * `x`/`y` are the margin in design px (1920x1080) from the anchored screen edges, inward; `center` moves right/down by them. Absent = the Figma position.
 */
export interface WidgetAnchor {
  h: 'left' | 'center' | 'right'
  v: 'top' | 'center' | 'bottom'
  x: number
  y: number
}
const H_ANCHORS: readonly string[] = ['left', 'center', 'right']
const V_ANCHORS: readonly string[] = ['top', 'center', 'bottom']

/** The `anchor` of an overlay entry, or undefined when absent or malformed (`overlayProblems` reports malformed ones). Missing x/y are 0. */
export function widgetAnchorOf(entry: unknown): WidgetAnchor | undefined {
  const a = (entry as { anchor?: unknown } | undefined)?.anchor as Record<string, unknown> | undefined
  if (!a || typeof a !== 'object' || !H_ANCHORS.includes(a['h'] as string) || !V_ANCHORS.includes(a['v'] as string)) return undefined
  const n = (v: unknown): number | undefined => (v === undefined ? 0 : typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const x = n(a['x'])
  const y = n(a['y'])
  if (x === undefined || y === undefined) return undefined
  return { h: a['h'] as WidgetAnchor['h'], v: a['v'] as WidgetAnchor['v'], x, y }
}

/** Debug hotkey of a HUD widget (`debugHotkey` on the widget frame's entry): a DirectInput scan code 1..255; 0 when absent or invalid (= off). */
export function debugHotkeyOf(entry: unknown): number {
  const k = (entry as { debugHotkey?: unknown } | undefined)?.debugHotkey
  return isScanCode(k) ? k : 0
}
const isScanCode = (k: unknown): k is number => typeof k === 'number' && Number.isInteger(k) && k >= 1 && k <= 255

/** A text layer whose overlay role is `text` is settable at runtime (a HUD widget gets AS2 `setTexts` and Papyrus `SetTexts`/`Show`/`Hide`). */
export const isSettableText = (entry: unknown): boolean => (entry as { role?: unknown } | undefined)?.role === 'text'

export interface NodeOverlayPatch {
  /** `null` removes the key. */
  role?: string | null
  instanceName?: string | null
  anchor?: WidgetAnchor | null
  debugHotkey?: number | null
  /** Graph ids attached to this node (`swfs/<name>/graphs/<id>.json`). */
  scripts?: string[] | null
  /** Data bindings as one string (`graphBinding.ts`); the Spec's `dataBinding` is a string. */
  dataBinding?: string | null
  /** `list` settings of a role-`list` frame (S8): item template layer and row spacing. */
  list?: { itemTemplate?: string; spacing?: number } | null
  /** Hash of an embedded custom font of the project (V5.6); wins over the alias rules. */
  font?: string | null
  /** Translation key of a text layer (V2.1): `$` + letters, digits, `_`. */
  locKey?: string | null
}

/** Immutable edit of one node's overlay entry. Unknown keys of the entry and of the document survive; an entry left empty is removed. */
export function patchNodeOverlay(doc: OverlayDoc, nodeId: string, patch: NodeOverlayPatch): OverlayDoc {
  const base = normalizeOverlay(doc)
  const entry: Record<string, unknown> = { ...(base.nodes?.[nodeId] ?? {}) }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) delete entry[k]
    else entry[k] = v
  }
  const nodes = { ...base.nodes }
  if (Object.keys(entry).length) nodes[nodeId] = entry
  else delete nodes[nodeId]
  return { ...base, nodes }
}

/** Problems with an overlay document before it is written (empty when fine): shape, and every instanceName must be an identifier. */
export function overlayProblems(doc: unknown): string[] {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return ['overlay: not an object']
  const nodes = (doc as OverlayDoc).nodes
  if (nodes === undefined) return []
  if (!nodes || typeof nodes !== 'object' || Array.isArray(nodes)) return ['overlay.nodes: not an object']
  const out: string[] = []
  for (const [id, n] of Object.entries(nodes)) {
    if (!n || typeof n !== 'object' || Array.isArray(n)) out.push(`overlay.nodes.${id}: not an object`)
    else {
      const name = (n as Record<string, unknown>)['instanceName']
      if (name !== undefined && (typeof name !== 'string' || instanceNameError(name))) out.push(`overlay.nodes.${id}.instanceName: not a valid identifier`)
      const role = (n as Record<string, unknown>)['role']
      if (role !== undefined && typeof role !== 'string') out.push(`overlay.nodes.${id}.role: not a string`)
      const font = (n as Record<string, unknown>)['font']
      if (font !== undefined && (typeof font !== 'string' || !/^[0-9a-f]{40}$/.test(font))) out.push(`overlay.nodes.${id}.font: not a font hash`)
      const locKey = (n as Record<string, unknown>)['locKey']
      if (locKey !== undefined && (typeof locKey !== 'string' || !/^\$[A-Za-z0-9_]{1,96}$/.test(locKey))) out.push(`overlay.nodes.${id}.locKey: must be $ followed by letters, digits or _ (at most 96)`)
      const scripts = (n as Record<string, unknown>)['scripts']
      if (scripts !== undefined && !(Array.isArray(scripts) && scripts.every((x) => typeof x === 'string'))) out.push(`overlay.nodes.${id}.scripts: not a list of graph ids`)
      const key = (n as Record<string, unknown>)['debugHotkey']
      if (key !== undefined && !isScanCode(key)) out.push(`overlay.nodes.${id}.debugHotkey: needs an integer scan code 1..255`)
      if ((n as Record<string, unknown>)['anchor'] !== undefined && !widgetAnchorOf(n)) out.push(`overlay.nodes.${id}.anchor: needs h (left/center/right), v (top/center/bottom) and numeric x/y`)
    }
  }
  return out
}

/** Translation keys (V2.1) of the overlay nodes that have one, by Figma layer id; keys of the wrong shape are still returned (the lint reports them, the compiler only passes them on). */
export function locKeysOf(nodes: Record<string, { locKey?: unknown }>): Record<string, string> {
  return Object.fromEntries(Object.entries(nodes).flatMap(([id, o]) => (typeof o.locKey === 'string' && o.locKey ? [[id, o.locKey]] : [])))
}

/** `list` settings (S8) of the overlay nodes that have them, by Figma layer id: item template layer and row spacing; malformed members are ignored. */
export function listSettings(nodes: Record<string, { list?: unknown }>): Record<string, { itemTemplate?: string; spacing?: number }> {
  const out: Record<string, { itemTemplate?: string; spacing?: number }> = {}
  for (const [id, o] of Object.entries(nodes)) {
    const l = o.list as { itemTemplate?: unknown; spacing?: unknown } | undefined
    if (!l || typeof l !== 'object') continue
    out[id] = { ...(typeof l.itemTemplate === 'string' && l.itemTemplate ? { itemTemplate: l.itemTemplate } : {}), ...(typeof l.spacing === 'number' && Number.isFinite(l.spacing) && l.spacing >= 0 ? { spacing: l.spacing } : {}) }
  }
  return out
}
