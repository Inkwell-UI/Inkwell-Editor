import { Copy, ChevronRight, type LucideIcon } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { strings } from '../../shared/strings'
import { Btn } from './Btn'

/**
 * The parts every Inspector is built from (graph node, component props, layer), so they share one shape: `InspHeader` (name, a dim type line, an optional action),
 * `InspCard` (a titled card), `InspFold` (a card that folds, its summary shown while closed) and `InspFoot` (kind or ID, small, with a copy button, at the very bottom).
 * The root of an Inspector is `<div className="insp insp-fill">` so the footer can sit at the bottom of the panel (`docs/ui-style.md`, rule 14).
 */
export function InspHeader({ title, sub, action, description }: { title: string; sub: string; action?: ReactNode; description?: string | undefined }) {
  return (
    <>
      <header className="insp-head">
        <div>
          <h3 className="insp-name">{title}</h3>
          <span className="dim insp-sub">{sub}</span>
        </div>
        {action}
      </header>
      {description && <p className="dim insp-desc">{description}</p>}
    </>
  )
}

/** A card with a title (and an optional icon and actions at the right of the title). */
export function InspCard({ title, icon: Icon, actions, testId, children }: { title: string; icon?: LucideIcon; actions?: ReactNode; testId?: string; children: ReactNode }) {
  const id = useId()
  return (
    <section className="insp-card" aria-labelledby={id} data-testid={testId}>
      <h4 id={id} className="insp-card-title">
        {Icon && <Icon size={14} aria-hidden="true" />}
        {title}
        {actions && <span className="insp-card-actions">{actions}</span>}
      </h4>
      {children}
    </section>
  )
}

// Which cards the user opened, kept for the session so selecting another layer shows the same ones open.
const memory = new Map<string, boolean>()

/** A card that folds. Closed, its summary line shows the state of what is inside. */
export function InspFold({ id, title, summary, defaultOpen, actions, children }: { id: string; title: string; summary: string; defaultOpen?: boolean; actions?: ReactNode; children: ReactNode }) {
  return (
    <details className="insp-fold" open={memory.get(id) ?? !!defaultOpen} onToggle={(e) => memory.set(id, e.currentTarget.open)} data-testid={`fold-${id}`}>
      <summary>
        <ChevronRight size={12} aria-hidden="true" className="fold-chev" />
        <span className="fold-title">{title}</span>
        <span className="fold-sum">{summary}</span>
        {/* a click on a button here must not fold the card */}
        {actions && <span className="insp-fold-actions" onClick={(e) => e.preventDefault()}>{actions}</span>}
      </summary>
      <div className="insp-fold-body">{children}</div>
    </details>
  )
}

/** The kind or ID of what is inspected, small, with a button that copies `copy` (the full ID). Selectable. */
export function InspFoot({ text, title, copy, testId }: { text: string; title?: string; copy: string; testId?: string }) {
  return (
    <footer className="insp-foot" data-testid={testId}>
      <span className="mono" title={title}>{text}</span>
      <Btn icon={Copy} label={strings.insp.copyId} variant="quiet" onClick={() => void navigator.clipboard?.writeText(copy).catch(() => undefined)} />
    </footer>
  )
}
