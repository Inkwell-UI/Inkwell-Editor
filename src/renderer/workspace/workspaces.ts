import type { LayoutNode } from './layout'

/**
 * The three workspaces of UX 2.3 as layout DATA. Every workspace contains every registered panel exactly once (checked by a test):
 * a workspace only changes how much room each zone gets and which dock tab is open. Sizes are shares (flex-grow) along each split;
 * the user's own sizes are stored per workspace by `state/workspaceStore.ts` and applied on top.
 *
 *   column [ row [ left tabs | column [ preview / graph ] | inspector ] / bottom dock tabs ]
 *   Zone 2 = left tabs, Zone 3 = preview, Zone 4 = graph, Zone 5 = inspector, Zone 6A = dock tabs.
 *   Zone 1 (top bar) and Zone 6B (status bar) are shell chrome around the layout, not layout panels.
 */
export type WorkspaceId = 'wire' | 'verify' | 'debug'

export interface WorkspaceDef {
  id: WorkspaceId
  layout: LayoutNode
}

const left: LayoutNode = { kind: 'tabs', tabs: [{ kind: 'panel', panel: 'navigator' }, { kind: 'panel', panel: 'contracts' }, { kind: 'panel', panel: 'assets' }] }
const dock = (active: string): LayoutNode => ({
  kind: 'tabs',
  active,
  tabs: [{ kind: 'panel', panel: 'lintBudget' }, { kind: 'panel', panel: 'localization' }, { kind: 'panel', panel: 'trace' }, { kind: 'panel', panel: 'mockData' }]
})

function make(id: WorkspaceId, s: { left: number; center: number; inspector: number; preview: number; graph: number; main: number; dock: number; dockTab: string }): WorkspaceDef {
  return {
    id,
    layout: {
      kind: 'split',
      direction: 'column',
      children: [
        {
          kind: 'split',
          direction: 'row',
          size: s.main,
          children: [
            { ...left, size: s.left },
            {
              kind: 'split',
              direction: 'column',
              size: s.center,
              children: [{ kind: 'panel', panel: 'preview', size: s.preview }, { kind: 'panel', panel: 'graph', size: s.graph }]
            },
            { kind: 'panel', panel: 'inspector', size: s.inspector }
          ]
        },
        { ...dock(s.dockTab), size: s.dock }
      ]
    }
  }
}

export const WORKSPACE_IDS: readonly WorkspaceId[] = ['wire', 'verify', 'debug']

export const WORKSPACES: Record<WorkspaceId, WorkspaceDef> = {
  // Wire: the graph is large; the preview is a strip; Inspector and Navigator small.
  wire: make('wire', { left: 1.3, center: 5, inspector: 1.7, preview: 2, graph: 3, main: 5, dock: 1.1, dockTab: 'lintBudget' }),
  // Verify: the stage is large; Navigator and the Lint dock small.
  verify: make('verify', { left: 1.1, center: 5.5, inspector: 1.5, preview: 5, graph: 0.7, main: 5, dock: 1.3, dockTab: 'lintBudget' }),
  // Debug: graph + AS2 split large; Trace & Watch dock and the preview small.
  debug: make('debug', { left: 1, center: 6, inspector: 1.5, preview: 2, graph: 3.5, main: 5, dock: 1.6, dockTab: 'trace' })
}

export const isWorkspaceId = (v: unknown): v is WorkspaceId => typeof v === 'string' && (WORKSPACE_IDS as readonly string[]).includes(v)
