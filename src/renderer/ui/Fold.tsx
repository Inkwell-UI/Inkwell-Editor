import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

// Which groups the user opened, kept for the session so selecting another layer shows the same groups open.
const memory = new Map<string, boolean>()

/** A collapsible group of the Inspector. Closed, its summary line shows the state of what is inside. */
export function Fold({ id, title, summary, defaultOpen, children }: { id: string; title: string; summary: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details className="fold" open={memory.get(id) ?? !!defaultOpen} onToggle={(e) => memory.set(id, e.currentTarget.open)} data-testid={`fold-${id}`}>
      <summary>
        <ChevronRight size={12} aria-hidden="true" className="fold-chev" />
        <span className="fold-title">{title}</span>
        <span className="fold-sum">{summary}</span>
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  )
}
