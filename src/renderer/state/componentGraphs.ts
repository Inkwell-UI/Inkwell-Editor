import type { Graph } from '@inkwell-ui/spec'
import { create } from 'zustand'
import type { InkwellApi } from '../../shared/ipc'

/** The behaviour graphs of the project's components (blueprint graphs, `components/*.json`), by Figma component id. Edits live in a graph store (`@comp:` name); this is the last saved copy the Components tab reads. */
interface State {
  graphs: Record<string, Graph>
  loaded: boolean
  error: string | undefined
}
export const useComponentGraphs = create<State>(() => ({ graphs: {}, loaded: false, error: undefined }))
type Api = Pick<InkwellApi, 'listComponentGraphs' | 'createComponentGraph' | 'deleteComponentGraph'>

let loading: Promise<void> | undefined
/** Reads the project's component graphs once. */
export function loadComponentGraphs(api: Api): Promise<void> {
  if (useComponentGraphs.getState().loaded) return Promise.resolve()
  return (loading ??= api
    .listComponentGraphs()
    .then((r) => useComponentGraphs.setState(r.ok ? { graphs: Object.fromEntries(r.graphs.flatMap((g) => (g.component ? [[g.component, g]] : []))), loaded: true, error: undefined } : { error: r.error }))
    .finally(() => (loading = undefined)))
}

/** The saved copy changed (a create, or an edit that was written). */
export const setComponentGraph = (g: Graph): void => {
  if (g.component) useComponentGraphs.setState((s) => ({ graphs: { ...s.graphs, [g.component!]: g } }))
}

export async function createComponentGraph(componentId: string, name: string, api: Api): Promise<{ ok: true; graph: Graph } | { ok: false; error: string }> {
  const r = await api.createComponentGraph(componentId, name)
  if (r.ok) setComponentGraph(r.graph)
  return r
}

export async function removeComponentGraph(componentId: string, api: Api): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await api.deleteComponentGraph(componentId)
  if (r.ok) useComponentGraphs.setState((s) => ({ graphs: Object.fromEntries(Object.entries(s.graphs).filter(([k]) => k !== componentId)) }))
  return r
}

/** Another project was opened. */
export function resetComponentGraphs(): void {
  loading = undefined
  useComponentGraphs.setState({ graphs: {}, loaded: false, error: undefined })
}
