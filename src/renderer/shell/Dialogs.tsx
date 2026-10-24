import { useDialogStore } from '../state/dialogStore'
import { strings } from '../strings'
import { Dialog } from '../ui/Dialog'

/** Modal dialogs; only one is open at a time (dialogStore). Config Ownership and the Figma guide are stubs. */
export function Dialogs() {
  const open = useDialogStore((s) => s.open)
  const close = useDialogStore((s) => s.close)
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
  if (open === 'figmaSetup')
    return (
      <Dialog title={strings.dialogs.figma.title} onClose={close}>
        <p>{strings.dialogs.figma.body}</p>
      </Dialog>
    )
  return null
}
