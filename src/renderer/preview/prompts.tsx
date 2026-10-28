import { useSyncExternalStore } from 'react'
import { Gamepad2, Keyboard } from 'lucide-react'
import type { PromptDevice } from '@inkwell-ui/spec'
import { strings } from '../strings'
import { previewBus } from './previewBus'

// The Prompts preview toggle (W4, UX 4.3 `[Prompts: Xbox v]`): which glyphs the preview's prompts show. The mock bridge answers getInputDevice from the mock key `inputDevice` and
// getSetting("Prompts", "Gamepad") from `setting.Prompts.Gamepad`; the menu class reads the pad style once when it starts, so a change reopens the menu. Module-level like uiScale.
let device: PromptDevice = 'keyboard'
const subs = new Set<() => void>()

function apply(): boolean {
  previewBus.call('inkwellMock', 'inputDevice', device === 'keyboard' ? 'keyboardMouse' : 'gamepad')
  previewBus.call('inkwellMock', 'setting.Prompts.Gamepad', device === 'playstation' ? 'playstation' : 'xbox')
  return previewBus.call('inkwellMenuReopen')
}

export const promptPreviewStore = {
  get: (): PromptDevice => device,
  subscribe: (cb: () => void): (() => void) => (subs.add(cb), () => void subs.delete(cb)),
  set(v: PromptDevice): boolean {
    device = v
    subs.forEach((cb) => cb())
    return apply()
  },
  /** After a rebuild (the mock data was reset): only a pad choice needs applying. */
  reapply(): void {
    if (device !== 'keyboard') apply()
  }
}

const ORDER: readonly PromptDevice[] = ['keyboard', 'xbox', 'playstation']

/** One button that steps through keyboard, Xbox and PlayStation; the gamepad icon carries the face button of the pad style (A, cross). */
export function PromptsControl() {
  const v = useSyncExternalStore(promptPreviewStore.subscribe, promptPreviewStore.get)
  const next = ORDER[(ORDER.indexOf(v) + 1) % ORDER.length]!
  const label = strings.stage.promptsStep(strings.stage.promptDevices[v]!, strings.stage.promptDevices[next]!)
  return (
    <button type="button" className="btn btn-default" title={label} aria-label={label} data-testid="stage-prompts" data-device={v} onClick={() => promptPreviewStore.set(next)}>
      {v === 'keyboard' ? <Keyboard size={14} aria-hidden="true" /> : <Gamepad2 size={14} aria-hidden="true" />}
      {v !== 'keyboard' && <span className="btn-glyph" aria-hidden="true">{v === 'xbox' ? 'A' : '✕'}</span>}
    </button>
  )
}
