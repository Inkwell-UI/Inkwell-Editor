import { CircleCheck, CircleDashed, CircleX } from 'lucide-react'
import { useSyncState } from '../hooks/useSyncState'
import { useDialogStore } from '../state/dialogStore'
import { strings } from '../strings'
import { Dialog } from '../ui/Dialog'

/** The stub dialogs: each says what will live there and when it arrives. Only one is open at a time (dialogStore). */
export function Dialogs() {
  const open = useDialogStore((s) => s.open)
  const close = useDialogStore((s) => s.close)
  const sync = useSyncState()
  if (open === 'configOwnership')
    return (
      <Dialog title={strings.dialogs.config.title} onClose={close}>
        <p>{strings.dialogs.config.body}</p>
        <div className="two-col">
          <section><h3>{strings.dialogs.config.author}</h3><p className="dim">{strings.dialogs.config.authorNote}</p></section>
          <section><h3>{strings.dialogs.config.user}</h3><p className="dim">{strings.dialogs.config.userNote}</p></section>
        </div>
      </Dialog>
    )
  if (open === 'setupDoctor') {
    const ff = sync?.ffdec
    const status = (ok: boolean | undefined): React.ReactNode =>
      ok === undefined ? <CircleDashed size={14} aria-hidden="true" /> : ok ? <CircleCheck size={14} className="tone-ok" aria-hidden="true" /> : <CircleX size={14} className="tone-error" aria-hidden="true" />
    return (
      <Dialog title={strings.dialogs.doctor.title} onClose={close}>
        <p>{strings.dialogs.doctor.body}</p>
        <ul className="plain checks">
          {strings.dialogs.doctor.checks.map((c) => {
            const live = c.id === 'java' ? (ff ? ff.reason !== 'java' : undefined) : c.id === 'ffdec' ? (ff ? ff.reason !== 'ffdec' && ff.reason !== 'wrapper' : undefined) : undefined
            return (
              <li key={c.id}>
                {status(live)}
                <div>
                  <strong>{c.title}</strong>
                  <p className="dim">{c.note}</p>
                  {live === false && <p className="tone-error">{strings.dialogs.doctor.missing(c.id === 'java' ? 'java' : ff?.reason === 'wrapper' ? 'wrapper' : 'ffdec')}</p>}
                </div>
              </li>
            )
          })}
        </ul>
      </Dialog>
    )
  }
  if (open === 'figmaSetup')
    return (
      <Dialog title={strings.dialogs.figma.title} onClose={close}>
        <p>{strings.dialogs.figma.body}</p>
      </Dialog>
    )
  return null
}
