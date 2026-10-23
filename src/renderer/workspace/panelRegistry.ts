import type { ComponentType } from 'react'
import { BuildStatusPanel } from '../panels/BuildStatusPanel'
import { ConnectionPanel } from '../panels/ConnectionPanel'
import { FontsPanel } from '../panels/FontsPanel'
import { LintPanel } from '../panels/LintPanel'
import { PreviewPanel } from '../panels/PreviewPanel'
import { TimingPanel } from '../panels/TimingPanel'
import { strings } from '../strings'

export interface PanelDef {
  /** Shown in menus / pickers (a panel draws its own title bar). */
  title: string
  /** Takes no props: a panel gets its data from hooks. */
  component: ComponentType
  /** Preferred size in px; used as the flex basis along a split's axis. */
  defaultSize: { width: number; height: number }
  /** The workspace never shrinks the panel's slot below this. */
  minSize: { width: number; height: number }
}

/** Panel id (what layouts refer to) -> definition. Add a panel here, then place its id in a layout. */
export const panelRegistry = {
  connection: { title: strings.panelConnection, component: ConnectionPanel, defaultSize: { width: 280, height: 130 }, minSize: { width: 200, height: 60 } },
  buildStatus: { title: strings.panelBuildStatus, component: BuildStatusPanel, defaultSize: { width: 280, height: 110 }, minSize: { width: 200, height: 60 } },
  timing: { title: strings.panelTiming, component: TimingPanel, defaultSize: { width: 280, height: 220 }, minSize: { width: 200, height: 80 } },
  preview: { title: strings.panelPreview, component: PreviewPanel, defaultSize: { width: 640, height: 420 }, minSize: { width: 320, height: 240 } },
  fonts: { title: strings.fontsTitle, component: FontsPanel, defaultSize: { width: 400, height: 180 }, minSize: { width: 240, height: 80 } },
  lint: { title: strings.lintTitle, component: LintPanel, defaultSize: { width: 400, height: 180 }, minSize: { width: 240, height: 80 } }
} satisfies Record<string, PanelDef>

export type PanelId = keyof typeof panelRegistry
export const panelIds: string[] = Object.keys(panelRegistry)
