import type { BuildTiming } from './timing'

/** Deploy types shared by main and renderer (UX 4.1). `package` and `vortex` both save a zip (Vortex installs it; nothing is written into Vortex's folders). */
export type DeployTargetId = 'mo2Mod' | 'mo2Overwrite' | 'package' | 'vortex'
export const isPackageTarget = (id: DeployTargetId): boolean => id === 'package' || id === 'vortex'
export type DeployScope = 'all' | 'active'

export interface DeployTargetInfo {
  id: DeployTargetId
  label: string
  /** The exact folder that will be written (shown in the dropdown). */
  path?: string
  /** Why it cannot be used; the control stays visible and disabled with this reason. */
  disabledReason?: string
  /** The user already confirmed this exact folder for the open project. */
  confirmed?: boolean
}

export interface DeployFileInfo {
  /** Forward-slash path relative to the target folder. */
  rel: string
  size: number
  swf: string
}
export interface DeployLintItem {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  /** SWF name; absent for deploy-level notices (plan warnings). */
  swf?: string
  /** Figma node id, so the dialog can link to the layer. */
  nodeId?: string
  layerName?: string
}

/** The export gate (design spec, "Severity levels"): errors block, warnings deploy and are listed, info is panel only; Strict Mode promotes warnings. */
export interface GateResult {
  ok: boolean
  strict: boolean
  /** Errors, plus warnings promoted by Strict Mode. */
  blocking: DeployLintItem[]
  warnings: DeployLintItem[]
  info: DeployLintItem[]
}

export type PrepareResult =
  | { ok: true; token: string; root: string; files: DeployFileInfo[]; removed: string[]; needsConfirm: boolean; gate: GateResult; lint: DeployLintItem[]; notes: string[] }
  | { ok: false; error: string; lint?: DeployLintItem[] }

export interface DeployResult {
  ok: boolean
  error?: string
  root?: string
  written?: number
  unchanged?: number
  removed?: string[]
  /** Previously deployed files that were left alone because they changed since. */
  kept?: string[]
  timing?: BuildTiming
  /** Package targets: the zip that was written. */
  zipPath?: string
  /** The user closed the save dialog; nothing was written. */
  cancelled?: boolean
}

/** Progress and last result, shown in the status bar and as a toast. */
export interface DeployState {
  state: 'preparing' | 'writing' | 'done' | 'error'
  message: string
  timing?: BuildTiming
}
