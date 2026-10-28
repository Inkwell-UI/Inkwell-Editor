/** One finished build as the status bar shows it. `previewMs` arrives later (the renderer reports it after the first frame). */
export interface BuildRecord {
  seq: number
  swfName: string
  /** Pipeline stages in ms (`sync`, `codegen`, `swf`, `ffdec`, `preview-build`). */
  stages: Record<string, number>
  /** Pipeline total in ms. */
  total: number
  previewMs?: number
}

export const HISTORY_KEEP = 50
/** The edit-to-preview target: 3 s (the design spec ("Build pipeline and preview") says 1 s; changed on the owner's request). */
export const TARGET_MS = 3000

/** Appends a build (replacing one with the same seq), keeps the last `keep`. */
export function addBuild(history: readonly BuildRecord[], rec: BuildRecord, keep = HISTORY_KEEP): BuildRecord[] {
  const next = [...history.filter((h) => h.seq !== rec.seq), rec].sort((a, b) => a.seq - b.seq)
  return next.slice(-keep)
}

/** Sets the Ruffle time on the newest build (the report is for the latest seq). Unknown seq: unchanged. */
export function attachPreview(history: readonly BuildRecord[], seq: number, previewMs: number): BuildRecord[] {
  return history.map((h) => (h.seq === seq ? { ...h, previewMs } : h))
}

/** Pipeline total plus the preview time: the edit-to-preview time the design spec measures (the Figma debounce is not included). */
export const editToPreview = (r: BuildRecord): number => r.total + (r.previewMs ?? 0)

export const isOverTarget = (r: BuildRecord | undefined): boolean => !!r && editToPreview(r) > TARGET_MS
