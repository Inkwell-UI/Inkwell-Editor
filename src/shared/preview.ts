/** What the Ruffle preview cannot show faithfully for one SWF (feeds the badge). */
export interface PreviewNotes {
  /** Text nodes using GFx TextField extensions (verticalAlign, textAutoSize); Ruffle ignores them. */
  textExtensions: number
  /** Text nodes drawn with a device font instead of the Skyrim font. */
  textNodes: number
  /** Skyrim faces drawn with a bundled lookalike (not the installed game font); the badge lists them. */
  approximated: string[]
}

/** A font file for the Ruffle preview; `name` is what the preview SWF refers to. */
export interface PreviewFontBlob {
  name: string
  bytes: ArrayBuffer
}

/** One preview build of one SWF, main -> renderer. */
export interface PreviewBuild {
  /** Increases with every build; the renderer echoes it in its timing report. */
  seq: number
  swfId: string
  name: string
  /** Design size in px (the stage of the preview SWF). */
  stage: { width: number; height: number }
  notes: PreviewNotes
  /** The preview SWF; absent when the preview build failed. */
  bytes?: ArrayBuffer
  error?: string
}

/** Renderer -> main: Ruffle drew the first frame of build `seq`, `ms` after the renderer received it. */
export interface PreviewRendered {
  seq: number
  ms: number
}

/** The four aspect ratios of 1.0 (width / height). */
export const ASPECTS = { '16:9': 16 / 9, '16:10': 16 / 10, '21:9': 21 / 9, '32:9': 32 / 9 } as const
export type AspectId = keyof typeof ASPECTS
