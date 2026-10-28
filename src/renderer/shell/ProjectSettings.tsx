import { useEffect, useState } from 'react'
import { inkwell } from '../hooks/api'
import { useProject } from '../hooks/useProject'
import { useLocalizationStore } from '../state/localizationStore'
import { modIdProblem } from '../../shared/modId'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'

const s = strings.settings.project
/** Project Settings section (only with a project open): the Mod id, checked while typing; a rename warns that the deployed file names change. */
export function ProjectSettings() {
  const project = useProject()
  const current = project?.modId ?? ''
  const [draft, setDraft] = useState(current)
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>()
  useEffect(() => setDraft(current), [current])
  if (!project) return null
  const problem = modIdProblem(draft)
  const changed = draft !== current
  const save = (): void => {
    if (problem || !changed) return
    void inkwell?.setModId(draft).then((r) => {
      setMsg(r.ok ? { ok: true, text: s.saved(draft) } : { ok: false, text: r.error })
      if (r.ok) void useLocalizationStore.getState().load() // its modId names the translation files
    })
  }
  return (
    <section data-testid="project-settings" aria-labelledby="project-settings-title">
      <h3 id="project-settings-title">{s.title}</h3>
      <label className="field">
        <span>{s.modId}</span>
        <input
          value={draft}
          spellCheck={false}
          aria-invalid={!!problem}
          aria-describedby="mod-id-help"
          onChange={(e) => { setDraft(e.target.value); setMsg(undefined) }}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setDraft(current) }}
          data-testid="mod-id"
        />
      </label>
      <p id="mod-id-help" className={problem ? 'tone-error' : 'dim'} role={problem ? 'alert' : undefined} data-testid="mod-id-check">{problem ?? s.modIdHelp}</p>
      {changed && !problem && <p className="tone-warn" data-testid="mod-id-rename">{s.renameWarning(current, draft)}</p>}
      {msg && <p className={msg.ok ? 'tone-ok' : 'tone-error'} role="status" data-testid="mod-id-msg">{msg.text}</p>}
      <div className="row-actions">
        <Btn variant="primary" onClick={save} reason={problem ?? (changed ? undefined : s.unchanged)} testId="mod-id-save">{s.rename}</Btn>
      </div>
    </section>
  )
}
