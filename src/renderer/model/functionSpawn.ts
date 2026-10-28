import type { NodeDef as KwDef, SpawnOption } from '@nicklaj/knotwork'
import type { Graph } from '@inkwell-ui/spec'

/**
 * Functions in the Add Node search: typing "f " first lists functions instead of nodes ("f PlusOne" finds the ones named PlusOne). Each is a menu option whose def is not a real node kind
 * (`fn:<graph id>`); picking it places a Call Function node of that function. Knotwork's filter matches every word against label, kind and keywords, so the keyword "f" makes the first word match.
 */
const KIND = 'fn:'

export const functionOption = (fn: Graph): SpawnOption<KwDef> => ({
  def: { kind: `${KIND}${fn.id}`, category: 'functions', title: fn.name, keywords: ['f', 'function'], pins: [] },
  label: fn.id.includes('/') ? `${fn.name} (${fn.id.split('/')[0]})` : fn.name
})

/** The function graph id behind a menu option made by `functionOption`, or undefined for an ordinary node option. */
export const functionOfOption = (o: SpawnOption<KwDef>): string | undefined => (o.def.kind.startsWith(KIND) ? o.def.kind.slice(KIND.length) : undefined)
