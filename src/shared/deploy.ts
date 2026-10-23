import type { BuildTiming } from './timing'

/** Deploy types shared by main and renderer (UX 4.1). MO2 only for now; Vortex and Package are listed but disabled. */
export type DeployTargetId = 'mo2Mod' | 'mo2Overwrite'
export type DeployScope = 'all' | 'active'

export interface DeployTargetInfo {
  id: DeployTargetId | 'vortex' | 'package'
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
}

export type PrepareResult =
  | { ok: true; token: string; root: string; files: DeployFileInfo[]; removed: string[]; needsConfirm: boolean; lint: DeployLintItem[]; notes: string[] }
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
}

/** Progress and last result, shown in the status bar and as a toast. */
export interface DeployState {
  state: 'preparing' | 'writing' | 'done' | 'error'
  message: string
  timing?: BuildTiming
}
