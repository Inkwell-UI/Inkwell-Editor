import { shortcutGroups } from '../../shared/commands'
import { strings } from '../../shared/strings'
import { useDialogStore } from '../state/dialogStore'
import { Dialog } from '../ui/Dialog'

/** Keyboard shortcuts (F1, `?`, or the palette): the application's from `shared/commands.ts`, then the graph canvas's. */
export function ShortcutsDialog() {
  const close = useDialogStore((s) => s.close)
  return (
    <Dialog title={strings.shortcuts.title} onClose={close}>
      <div className="keys-list" data-testid="shortcuts-dialog">
        {shortcutGroups().map((g) => (
          <section key={g.title} aria-label={g.title}>
            <header className="section-title"><h3>{g.title}</h3></header>
            <dl>
              {g.rows.map(([label, keys]) => (
                <div key={label} className="keys-row"><dt>{label}</dt><dd><kbd>{keys}</kbd></dd></div>
              ))}
            </dl>
          </section>
        ))}
        <p className="dim">{strings.shortcuts.hint}</p>
      </div>
    </Dialog>
  )
}
