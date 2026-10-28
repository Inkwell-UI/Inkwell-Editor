import type { Swf } from '@inkwell-ui/spec'
import type { LayerRef } from '../../shared/syncState'

export interface ComponentRow {
  id: string
  name: string
  /** The SWF the component is in; undefined for one kept on the Figma page away from the design. */
  swfName?: string
  instances: number
}

/**
 * Every component the project has: the ones kept on the Figma page away from the design (names only, they are not synced yet) and the ones inside a SWF. A variant of a component set is part of
 * its set, not a component of its own. `instances` counts the instances placed in the SWFs.
 */
export function componentRows(swfs: readonly Pick<Swf, 'name' | 'nodes' | 'root'>[], onPage: readonly LayerRef[] = []): ComponentRow[] {
  const used = new Map<string, number>()
  for (const s of swfs) for (const n of Object.values(s.nodes)) if (n.type === 'instance') used.set(n.component, (used.get(n.component) ?? 0) + 1)
  const rows: ComponentRow[] = onPage.map((c) => ({ id: c.id, name: c.name, instances: used.get(c.id) ?? 0 }))
  const onPageIds = new Set(onPage.map((c) => c.id))
  for (const s of swfs) {
    // only what the SWF's design still reaches: a component moved out of the frame can linger in the saved IR until the plugin reports it gone
    const reached = new Set<string>()
    for (const stack = [s.root]; stack.length; ) {
      const id = stack.pop()!
      if (!reached.has(id) && s.nodes[id]) (reached.add(id), stack.push(...s.nodes[id]!.children))
    }
    for (const n of Object.values(s.nodes))
      if (n.type === 'component' && reached.has(n.id) && !onPageIds.has(n.id) && !(n.parent && s.nodes[n.parent]?.type === 'component')) rows.push({ id: n.id, name: n.name, swfName: s.name, instances: used.get(n.id) ?? 0 })
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}
