import { useSyncExternalStore } from 'react'
import { Scaling } from 'lucide-react'
import { UI_SCALE_RANGE } from '@inkwell-ui/spec'
import { strings } from '../strings'
import { Popover } from '../ui/Popover'
import { previewBus } from './previewBus'

// The preview's UI Scale (SPEC-CHANGES S9): the same number the user INI's `UIScale` would hand the menu. Module-level like previewBus, so the toolbar (stage), the Play panel
// and the preview panel's "re-apply after a rebuild" effect share it. The mock bridge gets it through `inkwellUiScale`, which reopens the menu so the glue applies it.
let scale = 1
const subs = new Set<() => void>()

export const clampUiScale = (v: number): number => (Number.isFinite(v) ? Math.min(UI_SCALE_RANGE.max, Math.max(UI_SCALE_RANGE.min, Math.round(v * 100) / 100)) : 1)

export const uiScaleStore = {
  get: (): number => scale,
  subscribe: (cb: () => void): (() => void) => (subs.add(cb), () => void subs.delete(cb)),
  /** Sets the scale and applies it to the running movie (false = nothing is running). */
  set(v: number): boolean {
    scale = clampUiScale(v)
    subs.forEach((cb) => cb())
    return previewBus.call('inkwellUiScale', scale, 0, 0)
  },
  /** After a rebuild restarted the movie: only a changed scale needs applying. */
  reapply(): void {
    if (scale !== 1) previewBus.call('inkwellUiScale', scale, 0, 0)
  }
}

export const useUiScale = (): number => useSyncExternalStore(uiScaleStore.subscribe, uiScaleStore.get)

/** Slider in the stage toolbar / Play panel (custom menus only); the value is shown next to it, double-click the value for 1. */
export function UiScaleControl({ testId }: { testId: string }) {
  const v = useUiScale()
  return (
    <label className="inline" title={strings.stage.uiScaleTip}>
      <span>{strings.stage.uiScale}</span>{' '}
      <input
        type="range" className="ui-scale-input" min={UI_SCALE_RANGE.min} max={UI_SCALE_RANGE.max} step={0.05} value={v}
        onChange={(e) => e.target.value !== '' && uiScaleStore.set(Number(e.target.value))} aria-label={strings.stage.uiScale} data-testid={testId}
      />{' '}
      <output className="ui-scale-value" onDoubleClick={() => uiScaleStore.set(1)} title={strings.stage.uiScaleReset}>{v.toFixed(2)}</output>
    </label>
  )
}

/** The toolbar's UI scale: a button with the value ("1.25x") that opens the slider, so it costs as much room as the other buttons. */
export function UiScaleButton({ testId }: { testId: string }) {
  const v = useUiScale()
  return (
    <Popover
      label={strings.stage.uiScale}
      align="end"
      className="ui-scale-pop"
      trigger={(p) => (
        <button type="button" className="btn" {...p} title={strings.stage.uiScaleTip} aria-label={`${strings.stage.uiScale}: ${v.toFixed(2)}`} data-testid={`${testId}-btn`}>
          <Scaling size={14} aria-hidden="true" /> <span className="ui-scale-value">{v.toFixed(2)}&times;</span>
        </button>
      )}
    >
      <UiScaleControl testId={testId} />
    </Popover>
  )
}
