import type { LayoutNode } from './layout'

/**
 * The three modes of the editor as layout DATA (Blender-style: one job per mode, less on screen at a time). A mode shows only the panels
 * it needs, so a panel may be absent from a mode but is in at least one (checked by a test). Sizes are shares (flex-grow) along each split;
 * the user's own sizes are stored per mode by `state/workspaceStore.ts` and applied on top.
 *
 *   Layout:       [ left tabs | preview | inspector ] / dock
 *   Behaviour:    [ left tabs | column [ preview strip / graph ] | inspector ] / dock
 *   Localization: [ left tabs | preview | inspector ] / dock (Localization first and large)
 *   Zone 1 (top bar) and Zone 6B (status bar) are shell chrome around the layout, not layout panels.
 */
export type WorkspaceId = 'layout' | 'behaviour' | 'localization'

export interface WorkspaceDef {
  id: WorkspaceId
  layout: LayoutNode
}

const tabs = (panels: string[], active?: string, size?: number): LayoutNode => ({
  kind: 'tabs',
  ...(active ? { active } : {}),
  ...(size ? { size } : {}),
  tabs: panels.map((panel) => ({ kind: 'panel' as const, panel }))
})

const frame = (left: LayoutNode, center: LayoutNode, dock: LayoutNode, shares: { main: number; dock: number }): LayoutNode => ({
  kind: 'split',
  direction: 'column',
  children: [
    { kind: 'split', direction: 'row', size: shares.main, children: [{ ...left, size: 1.3 }, { ...center, size: 5 }, { kind: 'panel', panel: 'inspector', size: 1.7 }] },
    { ...dock, size: shares.dock }
  ]
})

const preview: LayoutNode = { kind: 'panel', panel: 'preview' }

export const WORKSPACE_IDS: readonly WorkspaceId[] = ['layout', 'behaviour', 'localization']

export const WORKSPACES: Record<WorkspaceId, WorkspaceDef> = {
  // Layout: the stage is the whole centre; assets and the lint dock support it.
  layout: { id: 'layout', layout: frame(tabs(['navigator', 'assets']), preview, tabs(['lintBudget']), { main: 5, dock: 1.1 }) },
  // Behaviour: the graph is large, the preview a strip; contracts and variables (left tabs), trace, mock data and data binding (dock tabs) are the supporting views.
  behaviour: {
    id: 'behaviour',
    layout: frame(
      tabs(['navigator', 'contracts', 'variables']),
      {
        kind: 'split',
        direction: 'column',
        children: [{ ...preview, size: 2 }, { kind: 'panel', panel: 'graph', size: 3 }]
      },
      tabs(['trace', 'mockData', 'dataBinding', 'lintBudget'], 'trace'),
      { main: 5, dock: 1.4 }
    )
  },
  // Localization: the string table gets the room; the preview next to it (Locale and Pseudo-Loc toggles) shows the effect.
  localization: { id: 'localization', layout: frame(tabs(['navigator']), preview, tabs(['localization', 'lintBudget']), { main: 3, dock: 3 }) }
}

export const isWorkspaceId = (v: unknown): v is WorkspaceId => typeof v === 'string' && (WORKSPACE_IDS as readonly string[]).includes(v)
