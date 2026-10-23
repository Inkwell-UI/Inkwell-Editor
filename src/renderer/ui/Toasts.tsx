import { CircleCheck, CircleX, Info, X } from 'lucide-react'
import { useToastStore } from '../state/toastStore'
import { strings } from '../strings'

const ICON = { ok: CircleCheck, error: CircleX, info: Info } as const

/** Toast stack (bottom right). A polite live region; errors stay readable for 8 s and can be dismissed. */
export function Toasts() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICON[t.tone]
        return (
          <div key={t.id} className={`toast toast-${t.tone}`} data-testid="toast">
            <Icon size={16} aria-hidden="true" />
            <div className="toast-body">
              <strong>{t.title}</strong>
              {t.text && <p>{t.text}</p>}
            </div>
            <button type="button" className="btn btn-quiet" onClick={() => dismiss(t.id)} aria-label={strings.close} title={strings.close}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
