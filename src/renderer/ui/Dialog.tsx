import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { strings } from '../strings'

/** Modal dialog: focus moves in, Escape or the close button closes it, focus returns to where it was. Used for the stub dialogs. */
export function Dialog({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const titleId = useId()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    box.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      before?.focus?.()
    }
  }, [onClose])
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="dialog-title">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn btn-quiet" onClick={onClose} aria-label={strings.close} title={strings.close}>
            <X size={14} aria-hidden="true" />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  )
}
