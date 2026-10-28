import { Palette } from 'lucide-react'
import { themeModes } from '@inkwell-ui/spec'
import { useActiveSwf } from '../hooks/useProject'
import { inkwell } from '../hooks/api'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'

/** Theme mode of the stage toolbar (SPEC-CHANGES V6.3): rebuilds the preview SWF with another mode of the Figma variable collection. The game SWF keeps the menu's default theme. */
export function ThemeControl() {
  const swf = useActiveSwf()
  const modes = swf ? themeModes(swf.ir) : []
  if (!swf || modes.length < 2) return <Btn icon={Palette} reason={strings.stage.themeNone} testId="stage-theme">{strings.stage.theme}</Btn>
  return (
    <label className="inline select-icon" title={strings.stage.theme}>
      <Palette size={14} aria-hidden="true" /> <span className="sr-only">{strings.stage.theme}</span>
      <select value={swf.previewTheme ?? ''} onChange={(e) => void inkwell?.setPreviewTheme(swf.name, e.target.value)} aria-label={strings.stage.theme} data-testid="stage-theme">
        <option value="">{strings.stage.themeDefault}</option>
        {modes.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    </label>
  )
}
