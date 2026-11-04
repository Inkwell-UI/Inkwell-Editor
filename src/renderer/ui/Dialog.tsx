import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { strings } from '../../shared/strings'

/** Modal dialog: focus moves in, Escape or the close button closes it, focus returns to where it was. Used for the stub dialogs. */
export function Dialog({ title, onClose, children, wide, bare }: { title: string; onClose(): void; children: ReactNode; wide?: boolean; /** No title bar (the palette: the title would repeat the key just pressed); `title` stays as the accessible name and the panel sits near the top. */ bare?: boolean }) {
  const titleId = useId()
  const box = useRef<HTMLDivElement>(null)
  const [before] = useState(() => document.activeElement as HTMLElement | null) // read in render: a field with autoFocus has taken focus by the time effects run
  useEffect(() => {
    if (!box.current?.contains(document.activeElement)) box.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      before?.focus?.({ focusVisible: false } as FocusOptions) // give focus back without a ring; a keyboard user's next key shows it
    }
  }, [onClose, before])
  return (
    <div className={`dialog-backdrop${bare ? ' dialog-backdrop-top' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className={`dialog${wide ? ' dialog-wide' : ''}${bare ? ' dialog-bare' : ''}`} role="dialog" aria-modal="true" {...(bare ? { 'aria-label': title } : { 'aria-labelledby': titleId })} tabIndex={-1}>
        {!bare && (
          <header className="dialog-title">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="btn btn-quiet" onClick={onClose} aria-label={strings.close} title={strings.close}>
              <X size={14} aria-hidden="true" />
            </button>
          </header>
        )}
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  )
}
