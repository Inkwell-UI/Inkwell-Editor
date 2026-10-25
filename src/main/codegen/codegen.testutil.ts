// Test fixtures: one small graph per core node kind, built from the pack's own node definition.
import type { Graph, GraphNode, NodeDef } from '@inkwell-ui/spec'
import { resolve } from 'node:path'
import { resolvePins } from '../../shared/graphValidate'
import { loadCodegenPacks } from './packs'

export const corePack = resolve(__dirname, '../../../resources/packs/core')
export const loadCore = async () => (await loadCodegenPacks([corePack])).packs

export const node = (id: string, kind: string, fields: Record<string, unknown> = {}): GraphNode => ({ id, kind, fields, pos: { x: 0, y: 0 } }) as GraphNode
export const wire = (a: string, ap: string, b: string, bp: string) => ({ from: { node: a, pin: ap }, to: { node: b, pin: bp } })
export const graph = (id: string, nodes: GraphNode[], edges: Graph['edges'], variables: Graph['variables'] = []): Graph =>
  ({ specVersion: 5, id, name: id, scope: 'menu', nodes, edges, variables, comments: [], groups: [] }) as Graph

const isEntry = (d: NodeDef): boolean => (d.extra as { entry?: boolean } | undefined)?.entry === true
const isEditorOnly = (d: NodeDef): boolean => (d.extra as { editorOnly?: boolean } | undefined)?.editorOnly === true

/** Field values: schema default, else first enum value, else a type zero. Component pins point at the layer id `L`. */
function fieldsFor(d: NodeDef): Record<string, unknown> {
  const f: Record<string, unknown> = {}
  for (const [k, s] of Object.entries(d.fields) as [string, { default?: unknown; enum?: unknown[]; type?: string }][])
    f[k] = s.default ?? s.enum?.[0] ?? (s.type === 'number' || s.type === 'integer' ? 0 : s.type === 'boolean' ? false : '')
  if (d.kind === 'OnWidgetCall') f['params'] = [{ name: 'title', type: 'String' }, { name: 'hold', type: 'Number' }]
  if (d.kind === 'GetVariable' || d.kind === 'SetVariable' || d.kind === 'Toggle') f['variable'] = 'v1'
  for (const p of d.inputs) if (['Text', 'Button', 'List', 'Image', 'Clip'].includes(p.type)) f[p.name] = 'L'
  return f
}

/** A graph that exercises one node kind: entries are followed by Log; exec nodes hang off On Widget Call and every exec output leads to a Log; a pure node feeds a Log message. null for editor-only kinds. */
export function kindGraph(packId: string, d: NodeDef): Graph | null {
  if (isEditorOnly(d)) return null
  const kind = `${packId}/${d.kind}@${d.major}`
  const n = node('n1', kind, fieldsFor(d))
  const nodes: GraphNode[] = [n]
  const edges: Graph['edges'] = []
  const log = (id: string): void => void nodes.push(node(id, `${packId}/Log@1`, { level: 'info' }))
  const pins = resolvePins(d, n, [])
  if (d.pure) {
    nodes.unshift(node('e', `${packId}/OnWidgetCall@1`, { name: 'Run', params: [] }))
    log('l')
    edges.push(wire('e', 'then', 'l', 'in'), wire('n1', 'value', 'l', 'message'))
  } else {
    if (!isEntry(d)) {
      nodes.unshift(node('e', `${packId}/OnWidgetCall@1`, { name: 'Run', params: [{ name: 'title', type: 'String' }, { name: 'hold', type: 'Number' }] }))
      edges.push(wire('e', 'then', 'n1', 'in'))
    }
    for (const p of pins.outputs.filter((x) => x.type === 'Exec')) {
      log(`l_${p.name}`)
      edges.push(wire('n1', p.name, `l_${p.name}`, 'in'))
    }
  }
  return graph(`k-${d.kind}`, nodes, edges, [{ id: 'v1', name: 'count', type: 'Number', scope: 'menu', default: 0 }] as Graph['variables'])
}
