import type { Graph } from '@inkwell-ui/spec'
import { newGraphId } from '../../shared/graphs'
import type { BindProp } from '../../shared/graphBinding'

/** Pure logic of the Variables and Data binding panels. */
type Variable = Graph['variables'][number]
export const VARIABLE_TYPES = ['Bool', 'Number', 'String', 'Array', 'Object'] as const

export const defaultFor = (type: Variable['type']): unknown => (type === 'Bool' ? false : type === 'Number' ? 0 : type === 'String' ? '' : type === 'Array' ? [] : type === 'Object' ? {} : undefined)

/** A variable id from its name, unique among the ids of every graph of the SWF (a Get Variable node refers to the id, so renaming never breaks it). */
export function newVariableId(name: string, graphs: readonly Pick<Graph, 'variables'>[]): string {
  return newGraphId(name, new Set(graphs.flatMap((g) => g.variables.map((v) => v.id))))
}

/** Which graph a new variable of `scope` goes to, or why none can: a menu variable lives in the menu graph, a component variable in the open component graph. */
export function variableTarget(scope: 'menu' | 'component', o: { menuGraphId: string | undefined; activeId: string | undefined; activeScope: Graph['scope'] | undefined }): { graphId: string } | { reason: string } {
  if (scope === 'menu') return o.menuGraphId ? { graphId: o.menuGraphId } : { reason: 'The SWF has no menu graph yet' }
  return o.activeId && o.activeScope === 'component' ? { graphId: o.activeId } : { reason: 'Open a component graph first' }
}

/** Variables a layer's data binding can use: the menu graph's menu variables plus the variables of the graphs attached to that layer. */
export function bindableVariables(graphs: readonly Graph[], attached: readonly string[]): Variable[] {
  const menu = graphs.find((g) => g.scope === 'menu')
  return [...(menu?.variables.filter((v) => v.scope === 'menu') ?? []), ...graphs.filter((g) => g.scope === 'component' && attached.includes(g.id)).flatMap((g) => g.variables)]
}

/** The type a bound property wants; a differing source type is flagged in the panel (not blocked: codegen coerces at run time). */
const WANTS: Record<BindProp, readonly string[]> = { text: ['String', 'Number', 'Bool'], visible: ['Bool'], alpha: ['Number'], tint: ['Number'] }
export const bindingTypeOk = (prop: BindProp, type: string): boolean => WANTS[prop].includes(type)
export const mockType = (v: string | number | boolean): 'String' | 'Number' | 'Bool' => (typeof v === 'number' ? 'Number' : typeof v === 'boolean' ? 'Bool' : 'String')
/** A mock value from the editor's text and chosen type (a Number that does not parse stays a String-less 0 so the stored value always has its type). */
export function mockValue(type: 'String' | 'Number' | 'Bool', text: string): string | number | boolean {
  if (type === 'Number') return Number.isFinite(Number(text)) && text.trim() !== '' ? Number(text) : 0
  if (type === 'Bool') return text === 'true'
  return text
}
