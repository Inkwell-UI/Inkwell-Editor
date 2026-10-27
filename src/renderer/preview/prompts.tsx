import { useSyncExternalStore } from 'react'
import { Keyboard } from 'lucide-react'
import { PROMPT_DEVICES, type PromptDevice } from '@inkwell-ui/spec'
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

export function PromptsControl() {
  const v = useSyncExternalStore(promptPreviewStore.subscribe, promptPreviewStore.get)
  return (
    <label className="inline" title={strings.stage.promptsTip}>
      <Keyboard size={14} aria-hidden="true" /> <span>{strings.stage.prompts}</span>{' '}
      <select value={v} onChange={(e) => promptPreviewStore.set(e.target.value as PromptDevice)} aria-label={strings.stage.prompts} data-testid="stage-prompts">
        {PROMPT_DEVICES.map((d) => <option key={d} value={d}>{strings.stage.promptDevices[d]}</option>)}
      </select>
    </label>
  )
}
