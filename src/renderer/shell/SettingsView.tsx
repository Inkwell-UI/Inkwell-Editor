import { ArrowLeft, RefreshCw, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CheckId, CheckResult } from '../../shared/doctor'
import { FONTS_TEXT, FontsForFigma } from '../doctor/FontsForFigma'
import { attentionCount, DoctorRows, rowText } from '../doctor/SetupDoctorPanel'
import { STARTER_TEXT, StarterKit } from '../doctor/StarterKit'
import { useProject } from '../hooks/useProject'
import { useSetupDoctor } from '../hooks/useSetupDoctor'
import { useDialogStore } from '../state/dialogStore'
import { useSettingsStore } from '../state/settingsStore'
import { strings } from '../../shared/strings'
import { Btn } from '../ui/Btn'
import { Tip } from '../ui/Tip'
import { FIGMA_PLUGINS_TEXT, FigmaPlugins } from './FigmaPlugins'
import { ProjectSettings } from './ProjectSettings'

export type SettingsCategory = 'editor' | 'tools' | 'game' | 'figma' | 'project'

const s = strings.settings
const MIRROR_TEXT = `${strings.top.mirror} ${s.mirrorTip} ${strings.top.tidyHang} ${strings.top.tidyHangTip} ${s.categories.editor.name}`.toLowerCase()
const PROJECT_TEXT = `${s.project.title} ${s.project.modId} ${s.project.modIdHelp}`.toLowerCase()

/** The page each environment check lives on, by what it affects; a check not listed (a newer one) goes to Advanced rather than disappearing. */
const CHECK_PAGE: Partial<Record<CheckId, SettingsCategory>> = {
  java: 'tools', ffdec: 'tools', papyrus: 'tools',
  skyrim: 'game', mo2: 'game', skse: 'game', addresslib: 'game', runtime: 'game', skyui: 'game',
  figma: 'figma',
  wrapper: 'tools', vanilla: 'game', projectIgnore: 'project'
}
const pageOf = (r: CheckResult): SettingsCategory => CHECK_PAGE[r.id] ?? 'tools'
const CHECK_PAGES: SettingsCategory[] = ['tools', 'game', 'figma', 'project']
const PAGES: Exclude<SettingsCategory, 'project'>[] = ['editor', 'tools', 'game', 'figma']

/** The Settings view (Edit > Settings, and Edit > Project Settings which opens its Project page): replaces the workspace. A rail of pages grouped by what a setting affects; the search field lists every match across pages; Esc or Back returns. */
export function SettingsView({ initial = 'editor' }: { initial?: SettingsCategory }) {
  const close = useDialogStore((s) => s.close)
  const project = useProject()
  const mirror = useSettingsStore((s) => s.mirrorFigma)
  const setMirror = useSettingsStore((s) => s.setMirrorFigma)
  const tidyHang = useSettingsStore((s) => s.tidyHang)
  const setTidyHang = useSettingsStore((s) => s.setTidyHang)
  const d = useSetupDoctor()
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<SettingsCategory>(initial)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [close])

  const q = query.trim().toLowerCase()
  const page = chosen === 'project' && !project ? 'editor' : chosen
  const rowsOf = (c: SettingsCategory): CheckResult[] => d.results?.filter((r) => pageOf(r) === c) ?? []
  const has = (text: string): boolean => !q || text.includes(q)
  const checkHit = (c: SettingsCategory): boolean => rowsOf(c).some((r) => rowText(r).includes(q))
  const matches: Record<SettingsCategory, boolean> = {
    editor: has(MIRROR_TEXT),
    tools: checkHit('tools'),
    game: checkHit('game'),
    figma: checkHit('figma') || has(FIGMA_PLUGINS_TEXT) || has(STARTER_TEXT) || has(FONTS_TEXT),
    project: !!project && (has(PROJECT_TEXT) || checkHit('project'))
  }
  const visible = (c: SettingsCategory): boolean => (q ? matches[c] : page === c)
  const noMatch = !!q && !Object.values(matches).some(Boolean)
  const showCheckAgain = q ? true : CHECK_PAGES.includes(page)

  const rail = (c: SettingsCategory, name: string) => {
    const attn = c === 'project' || c === 'editor' ? 0 : attentionCount(rowsOf(c))
    return (
      <button key={c} type="button" className="rail-item" aria-current={page === c && !q ? 'page' : undefined} onClick={() => { setChosen(c); setQuery('') }} data-testid={`settings-page-${c}`}>
        <span>{name}</span>
        {attn > 0 && <span className="dot dot-warn" role="img" aria-label={s.needAttentionTip(attn)} title={s.needAttentionTip(attn)} />}
      </button>
    )
  }

  const head = (c: Exclude<SettingsCategory, 'project'>) => (
    <>
      <h3 id={`settings-title-${c}`}>{s.categories[c].name}</h3>
      <p className="dim settings-sub">{s.categories[c].sub}</p>
      {d.running && !rowsOf(c).length && c !== 'editor' && <p className="dim" role="status">{strings.doctor.running}</p>}
    </>
  )

  return (
    <section className="settings-view" aria-label={s.title} data-testid="settings-view">
      <header className="settings-head">
        <Btn icon={ArrowLeft} variant="quiet" onClick={close} label={s.backTip} testId="settings-back">{s.back}</Btn>
        <h2>{s.title}</h2>
        <span className="settings-spacer" />
        {showCheckAgain && <Btn icon={RefreshCw} variant="quiet" onClick={d.rerun} reason={d.running ? strings.doctor.running : undefined} label={s.checkAgainTip} testId="doctor-rerun">{s.checkAgain}</Btn>}
        <label className="search settings-search">
          <Search size={14} aria-hidden="true" />
          <input type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={s.searchPlaceholder} aria-label={s.search} data-testid="settings-search" />
        </label>
      </header>
      <div className="settings-split">
        <nav className="settings-rail" aria-label={s.categoriesLabel}>
          {PAGES.map((c) => rail(c, s.categories[c].name))}
          {project && rail('project', project.name)}
        </nav>
        <div className="settings-body">
          <div className="settings-col">
            {noMatch && <p className="dim" role="status">{s.noMatch}</p>}

            <section hidden={!visible('editor')} aria-labelledby="settings-title-editor">
              {head('editor')}
              <div className="settings-group">
              <label className="settingline">
                <span>{strings.top.mirror} <Tip text={s.mirrorTip} /></span>
                <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} data-testid="mirror-setting-view" />
              </label>
              <label className="settingline">
                <span>{strings.top.tidyHang} <Tip text={strings.top.tidyHangTip} /></span>
                <input type="checkbox" checked={tidyHang} onChange={(e) => setTidyHang(e.target.checked)} data-testid="tidy-hang-setting" />
              </label>
              </div>
            </section>

            {(['tools', 'game'] as const).map((c) => (
              <section key={c} hidden={!visible(c)} aria-labelledby={`settings-title-${c}`}>
                {head(c)}
                <DoctorRows d={d} inCategory={(r) => pageOf(r) === c} query={query} groupName={c === 'game' ? s.gameRequirements : undefined} />
              </section>
            ))}

            <section hidden={!visible('figma')} aria-labelledby="settings-title-figma">
              {head('figma')}
              <DoctorRows d={d} inCategory={(r) => pageOf(r) === 'figma'} query={query} />
              {has(FIGMA_PLUGINS_TEXT) && <FigmaPlugins />}
              {has(FONTS_TEXT) && <FontsForFigma />}
              {has(STARTER_TEXT) && <StarterKit />}
            </section>

            {project && (
              <section hidden={!visible('project')} aria-labelledby="settings-title-project">
                <h3 id="settings-title-project">{project.name}</h3>
                <ProjectSettings />
                <DoctorRows d={d} inCategory={(r) => pageOf(r) === 'project'} query={query} />
              </section>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
