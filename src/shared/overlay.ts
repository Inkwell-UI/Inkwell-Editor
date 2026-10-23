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

export interface NodeOverlayPatch {
  /** `null` removes the key. */
  role?: string | null
  instanceName?: string | null
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
    }
  }
  return out
}
