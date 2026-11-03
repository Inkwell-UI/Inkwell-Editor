import type { Graph } from '@inkwell-ui/spec'
import { useMemo } from 'react'
import { create, useStore } from 'zustand'
import { menuVariablesFor } from '../../shared/graphs'
import { menuGraphId } from '../state/graphDocs'
import { findGraphStore, type GraphStore } from '../state/graphStore'

const none = create<{ variables: Graph['variables'] }>(() => ({ variables: [] }))

/** The variables a graph's nodes can use: its own, and in a component's graph also the menu graph's menu variables (a layer graph's: the ones marked global) (codegen reaches them through the instance's owner chain). */
export function useVisibleVariables(store: GraphStore | undefined, swfId: string | undefined): Graph['variables'] {
  const own = useStore(store ?? none, (s) => s.variables)
  const scope = store?.getState().meta.scope
  const menuId = swfId && (scope === 'blueprint' || scope === 'component') ? menuGraphId(swfId) : undefined
  const menuStore = swfId && menuId ? findGraphStore(swfId, menuId) : undefined
  const menuVars = useStore(menuStore ?? none, (s) => s.variables)
  return useMemo(() => ((scope === 'blueprint' || scope === 'component') ? [...own, ...menuVariablesFor({ scope, variables: own }, [{ scope: 'menu', variables: menuVars }])] : own), [scope, own, menuVars])
}
