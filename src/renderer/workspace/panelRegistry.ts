import type { ComponentType } from 'react'
import { AssetsPanel } from '../panels/AssetsPanel'
import { ContractsPanel, useContractsTab } from '../panels/ContractsPanel'
import { GraphPanel } from '../panels/GraphPanel'
import { InspectorPanel } from '../panels/InspectorPanel'
import { LintBudgetPanel, useLintTab } from '../panels/LintBudgetPanel'
import { LibraryPanel } from '../panels/LibraryPanel'
import { LocalizationPanel } from '../panels/LocalizationPanel'
import { MockDataPanel } from '../panels/MockDataPanel'
import { NavigatorPanel } from '../panels/NavigatorPanel'
import { PreviewPanel } from '../panels/PreviewPanel'
import { TracePanel } from '../panels/TracePanel'
import { DataBindingPanel } from '../panels/DataBindingPanel'
import { VariablesPanel } from '../panels/VariablesPanel'
import { strings } from '../strings'

/** What a panel adds to its tab when it sits in a tab group (a hook, so it can read stores). */
export interface TabInfo {
  /** Replaces the title on the tab (counts etc.). */
  label?: string
  badge?: string
  /** Set = the tab cannot be chosen; the text is its tooltip (the one-line reason). */
  disabledReason?: string
}

export interface PanelDef {
  /** Shown in menus / pickers and on tabs (a panel draws its own title bar). */
  title: string
  /** Takes no props: a panel gets its data from hooks. */
  component: ComponentType
  /** Preferred size in px (informational; layouts size panels by share). */
  defaultSize: { width: number; height: number }
  /** The workspace never shrinks the panel's slot below this. */
  minSize: { width: number; height: number }
  /** Optional hook for the tab button when the panel is in a tab group. */
  useTabInfo?: () => TabInfo
}

/** Panel id (what layouts refer to) -> definition. Add a panel here, then place its id in every workspace layout (workspaces.ts). */
export const panelRegistry = {
  navigator: { title: strings.nav.title, component: NavigatorPanel, defaultSize: { width: 280, height: 500 }, minSize: { width: 200, height: 120 } },
  library: { title: strings.lib.title, component: LibraryPanel, defaultSize: { width: 280, height: 500 }, minSize: { width: 200, height: 120 } },
  contracts: { title: strings.contracts.title, component: ContractsPanel, defaultSize: { width: 280, height: 500 }, minSize: { width: 200, height: 120 }, useTabInfo: useContractsTab },
  assets: { title: strings.assets.title, component: AssetsPanel, defaultSize: { width: 280, height: 500 }, minSize: { width: 200, height: 120 } },
  preview: { title: strings.panelPreview, component: PreviewPanel, defaultSize: { width: 640, height: 420 }, minSize: { width: 240, height: 150 } },
  graph: { title: strings.graph.title, component: GraphPanel, defaultSize: { width: 640, height: 320 }, minSize: { width: 320, height: 90 } },
  inspector: { title: strings.insp.title, component: InspectorPanel, defaultSize: { width: 320, height: 500 }, minSize: { width: 240, height: 120 } },
  lintBudget: { title: strings.dock.lintTitle, component: LintBudgetPanel, defaultSize: { width: 800, height: 200 }, minSize: { width: 320, height: 70 }, useTabInfo: useLintTab },
  localization: { title: strings.loc.title, component: LocalizationPanel, defaultSize: { width: 800, height: 200 }, minSize: { width: 320, height: 70 } },
  trace: { title: strings.trace.title, component: TracePanel, defaultSize: { width: 800, height: 200 }, minSize: { width: 320, height: 70 } },
  mockData: { title: strings.mock.title, component: MockDataPanel, defaultSize: { width: 800, height: 200 }, minSize: { width: 320, height: 70 } },
  variables: { title: strings.vars.title, component: VariablesPanel, defaultSize: { width: 280, height: 500 }, minSize: { width: 200, height: 120 } },
  dataBinding: { title: strings.bind.title, component: DataBindingPanel, defaultSize: { width: 800, height: 200 }, minSize: { width: 320, height: 70 } }
} satisfies Record<string, PanelDef>

export type PanelId = keyof typeof panelRegistry
export const panelIds: string[] = Object.keys(panelRegistry)
