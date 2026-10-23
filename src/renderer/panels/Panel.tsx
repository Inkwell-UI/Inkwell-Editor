import { useId, useState, type ReactNode } from 'react'
import { strings } from '../strings'

/** Props of Panel, the chrome every panel wraps itself in. */
export interface PanelProps {
  title: string
  /** Show a collapse button in the title bar. Collapsing hides the body only; how much room the slot keeps is the layout's business. */
  collapsible?: boolean
  defaultCollapsed?: boolean
  /** Extra controls on the right of the title bar. */
  actions?: ReactNode
  children: ReactNode
}

/** Title bar plus a body that fills the available space and scrolls by itself. Knows nothing about where it is placed. */
export function Panel({ title, collapsible, defaultCollapsed, actions, children }: PanelProps) {
  const [collapsed, setCollapsed] = useState(Boolean(defaultCollapsed))
  const bodyId = useId()
  return (
    <section className="panel" aria-label={title}>
      <header className="panel-title">
        {collapsible && (
          <button className="panel-collapse" aria-expanded={!collapsed} aria-controls={bodyId} onClick={() => setCollapsed(!collapsed)} title={collapsed ? strings.panelExpand : strings.panelCollapse}>
            {collapsed ? '▸' : '▾'}
          </button>
        )}
        <h2>{title}</h2>
        <span className="panel-actions">{actions}</span>
      </header>
      <div id={bodyId} className="panel-body" hidden={collapsed}>
        {children}
      </div>
    </section>
  )
}
