import { SPEC_VERSION } from '@inkwell-ui/spec'
import { editToPreview, isOverTarget, type BuildRecord } from './timingHistory'

export const formatMs = (ms: number): string => (ms < 1 ? '<1 ms' : ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`)

/** `Spec 0.x`-style label: pre-beta builds show the number of SPEC_VERSION until v1 is frozen at 0.5 (design spec "Milestones"). */
export const specLabel = (v: number = SPEC_VERSION): string => `Spec 0.${v}`

const STAGE_ORDER = ['sync', 'codegen', 'swf', 'ffdec', 'preview-build']

export interface TimingLine {
  /** Edit-to-preview total (pipeline total + Ruffle first frame). */
  total: string
  /** `[name, "14 ms"]` in pipeline order, then the Ruffle time when measured. */
  parts: [string, string][]
  amber: boolean
}

/** The stages of one build in ms, in pipeline order, then the Ruffle time when measured. Stages not in the usual order come last. */
export function timingStages(r: BuildRecord): [string, number][] {
  const names = Object.keys(r.stages).sort((a, b) => {
    const ia = STAGE_ORDER.indexOf(a)
    const ib = STAGE_ORDER.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  const parts: [string, number][] = names.map((n) => [n, r.stages[n]!])
  if (r.previewMs !== undefined) parts.push(['preview', r.previewMs])
  return parts
}

/** Pure formatting of one build for the status bar and the history rows. Stages not in the usual order come last. */
export function timingLine(r: BuildRecord): TimingLine {
  return { total: formatMs(editToPreview(r)), parts: timingStages(r).map(([n, v]) => [n, formatMs(v)]), amber: isOverTarget(r) }
}

export { ffdecState } from '../../shared/ffdec'
