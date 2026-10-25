import { ArrowLeft, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { FONTS_TEXT, FontsForFigma } from '../doctor/FontsForFigma'
import { SetupDoctorPanel } from '../doctor/SetupDoctorPanel'
import { useDialogStore } from '../state/dialogStore'
import { useSettingsStore } from '../state/settingsStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { FIGMA_PLUGINS_TEXT, FigmaPlugins } from './FigmaPlugins'

const MIRROR_TEXT = `${strings.top.mirror} ${strings.top.mirrorNote} ${strings.settings.general}`.toLowerCase()

/** The Settings view (Edit > Settings): replaces the workspace. A search field filters every setting and check below it; Esc or Back returns. */
export function SettingsView() {
  const close = useDialogStore((s) => s.close)
  const mirror = useSettingsStore((s) => s.mirrorFigma)
  const setMirror = useSettingsStore((s) => s.setMirrorFigma)
  const [query, setQuery] = useState('')
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [close])
  const showMirror = !query.trim() || MIRROR_TEXT.includes(query.trim().toLowerCase())
  return (
    <section className="settings-view" aria-label={strings.settings.title} data-testid="settings-view">
      <header className="settings-head">
        <Btn icon={ArrowLeft} variant="quiet" onClick={close} label={strings.settings.backTip} testId="settings-back">{strings.settings.back}</Btn>
        <h2>{strings.settings.title}</h2>
      </header>
      <div className="settings-body">
       <div className="settings-col">
        <label className="search settings-search">
          <Search size={14} aria-hidden="true" />
          <input type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={strings.settings.searchPlaceholder} aria-label={strings.settings.search} data-testid="settings-search" />
        </label>
        {showMirror && (
          <section>
            <h3>{strings.settings.general}</h3>
            <label className="check">
              <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} data-testid="mirror-setting-view" /> {strings.top.mirror}
            </label>
            <p className="dim">{strings.top.mirrorNote}</p>
          </section>
        )}
        {(!query.trim() || FIGMA_PLUGINS_TEXT.includes(query.trim().toLowerCase())) && <FigmaPlugins />}
        <SetupDoctorPanel query={query} />
        {(!query.trim() || FONTS_TEXT.includes(query.trim().toLowerCase())) && <FontsForFigma />}
       </div>
      </div>
    </section>
  )
}
