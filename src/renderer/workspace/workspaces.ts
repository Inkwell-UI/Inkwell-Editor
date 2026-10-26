import type { LayoutNode } from './layout'

/**
 * The three modes of the editor as layout DATA (Blender-style: one job per mode, less on screen at a time). A mode shows only the panels
 * it needs, so a panel may be absent from a mode but is in at least one (checked by a test). Sizes are shares (flex-grow) along each split;
 * the user's own sizes are stored per mode by `state/workspaceStore.ts` and applied on top.
 *
 *   Layout:       [ left tabs | preview | inspector ] / dock
 *   Behaviour:    [ left tabs | graph | column [ preview (fixed size) / inspector ] ] / dock
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

const inspector: LayoutNode = { kind: 'panel', panel: 'inspector' }

const frame = (left: LayoutNode, center: LayoutNode, dock: LayoutNode, shares: { main: number; dock: number }, right: LayoutNode = { ...inspector, size: 1.7 }): LayoutNode => ({
  kind: 'split',
  direction: 'column',
  children: [
    { kind: 'split', direction: 'row', size: shares.main, children: [{ ...left, size: 1.3 }, { ...center, size: 5 }, { ...right, size: 1.7 }] },
    { ...dock, size: shares.dock }
  ]
})

const preview: LayoutNode = { kind: 'panel', panel: 'preview' }

/** px: title bar + compact toolbar + a 16:9 stage about the inspector column wide (~300 px) + the Ruffle notice. */
export const BEHAVIOUR_PREVIEW_HEIGHT = 280

export const WORKSPACE_IDS: readonly WorkspaceId[] = ['layout', 'behaviour', 'localization']

export const WORKSPACES: Record<WorkspaceId, WorkspaceDef> = {
  // Layout: the stage is the whole centre; assets and the lint dock support it.
  layout: { id: 'layout', layout: frame(tabs(['navigator', 'assets']), preview, tabs(['lintBudget']), { main: 5, dock: 1.1 }) },
  // Behaviour: the graph takes the whole centre; the preview is a small FIXED slot above the inspector (not resizable: its toolbar goes compact, the stage scales to fit); contracts and variables (left tabs), play, trace, mock data and data binding (dock tabs) are the supporting views.
  behaviour: {
    id: 'behaviour',
    layout: frame(
      tabs(['navigator', 'contracts', 'variables']),
      { kind: 'panel', panel: 'graph' },
      tabs(['play', 'trace', 'mockData', 'dataBinding', 'lintBudget'], 'trace'),
      { main: 5, dock: 1.4 },
      { kind: 'split', direction: 'column', children: [{ ...preview, fixed: BEHAVIOUR_PREVIEW_HEIGHT }, { ...inspector, size: 1 }] }
    )
  },
  // Localization: the string table gets the room; the preview next to it (Locale and Pseudo-Loc toggles) shows the effect.
  localization: { id: 'localization', layout: frame(tabs(['navigator']), preview, tabs(['localization', 'lintBudget']), { main: 3, dock: 3 }) }
}

export const isWorkspaceId = (v: unknown): v is WorkspaceId => typeof v === 'string' && (WORKSPACE_IDS as readonly string[]).includes(v)
