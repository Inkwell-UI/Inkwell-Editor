import { ArrowLeft } from 'lucide-react'
import { useEffect } from 'react'
import { useDialogStore } from '../state/dialogStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { ProjectSettings } from './ProjectSettings'

/** The Project Settings view (Edit > Project Settings, only with a project open): settings stored with the project. Esc or Back returns. */
export function ProjectSettingsView() {
  const close = useDialogStore((s) => s.close)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [close])
  return (
    <section className="settings-view" aria-label={strings.settings.project.title} data-testid="project-settings-view">
      <header className="settings-head">
        <Btn icon={ArrowLeft} variant="quiet" onClick={close} label={strings.settings.project.backTip} testId="project-settings-back">{strings.settings.back}</Btn>
        <h2>{strings.settings.project.title}</h2>
      </header>
      <div className="settings-body">
        <div className="settings-col">
          <ProjectSettings />
        </div>
      </div>
    </section>
  )
}
