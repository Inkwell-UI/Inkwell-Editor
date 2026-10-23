import type { Swf } from '@inkwell-ui/spec'
import type { OverlayDoc } from './overlay'

/** One SWF of the open project as the renderer sees it: the visual IR (read-only here) and its overlay (editable through `saveOverlay`). */
export interface SwfDoc {
  /** The top-level Figma frame's node id (the key in the sync protocol). */
  id: string
  /** Folder name under `swfs/`, also the build output name. */
  name: string
  /** Its Figma frame is gone; data is kept, nothing is built. */
  orphaned: boolean
  ir: Swf
  overlay: OverlayDoc
}

/** The open project, main -> renderer. `null` in the API means no project is open (start screen). */
export interface ProjectState {
  dir: string
  name: string
  modId: string
  /** Strict Mode (design spec): warnings count as errors. Stored in project.json. */
  strictMode: boolean
  swfs: SwfDoc[]
}

export interface RecentProject {
  dir: string
  name: string
  /** ISO time of the last open. */
  openedAt: string
}

/** Result of opening or creating a project. `cancelled`: the user closed the native dialog. */
export type OpenResult = { ok: true } | { ok: false; error: string } | { ok: false; cancelled: true }

/** Renderer <-> renderer events relayed through main so the detached preview window and the main window stay in step. */
export type UiEvent =
  | { type: 'activeSwf'; swfId: string }
  | { type: 'select'; swfId: string; nodeId: string }
  | { type: 'selectionCleared' }
