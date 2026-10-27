import { useSyncExternalStore } from 'react'
import { UI_SCALE_RANGE } from '@inkwell-ui/spec'
import { strings } from '../strings'
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
