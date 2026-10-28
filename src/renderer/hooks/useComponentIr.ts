import { SPEC_VERSION, type Swf } from '@inkwell-ui/spec'
import { useMemo } from 'react'
import { useSwfGraphs } from './useGraphs'
import { useActiveSwf } from './useProject'
import { useSyncState } from './useSyncState'

/** What the open component graph's component is made of: its node and everything under it, shaped like a SWF so the layer tree and the layer pickers work on it unchanged. */
export interface ComponentIr {
  componentId: string
  name: string
  ir: Swf
  /** The SWF holds the component itself (its overlay names apply); false when the component sits on the Figma page away from the design. */
  inSwf: boolean
}

/**
 * While a component's graph (blueprint) is open: the composition of that component, from the active SWF if the component is in it, else from what the plugin sent for components kept
 * on the page. `undefined` for any other graph; `'unavailable'` when the graph is a component's but its layers are not known (Figma is not connected and the component is in no SWF).
 */
export function useComponentIr(): ComponentIr | 'unavailable' | undefined {
  const swf = useActiveSwf()
  const { store } = useSwfGraphs()
  const sync = useSyncState()
  const meta = store?.getState().meta // the scope and the component id never change in a store
  const component = meta?.scope === 'blueprint' && typeof meta.component === 'string' ? meta.component : undefined
  return useMemo(() => {
    if (!component) return undefined
    const own = swf?.ir.nodes[component]
    if (swf && own) return { componentId: component, name: own.name, ir: { ...swf.ir, root: component }, inSwf: true }
    const tree = sync?.pageComponentTrees?.find((t) => t.id === component)
    if (!tree) return 'unavailable'
    const ir = { specVersion: SPEC_VERSION, id: component, name: tree.name, target: { kind: 'hudWidget' }, stage: { width: 1280, height: 720 }, root: component, nodes: tree.nodes } as unknown as Swf
    return { componentId: component, name: tree.name, ir, inSwf: false }
  }, [component, swf, sync?.pageComponentTrees])
}
