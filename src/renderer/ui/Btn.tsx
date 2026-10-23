import { useId, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface BtnProps {
  /** Visible text. Omit for an icon-only button (then `label` is required and becomes the tooltip). */
  children?: ReactNode
  icon?: LucideIcon
  /** Accessible name and tooltip. Required for icon-only buttons. */
  label?: string
  /** Why the control does not work yet. Makes it `aria-disabled` (still focusable and hoverable, so the reason is reachable) and shows the reason as its tooltip. */
  reason?: string | undefined
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  pressed?: boolean
  variant?: 'default' | 'primary' | 'quiet' | 'danger'
  testId?: string
  className?: string
  expanded?: boolean
  haspopup?: 'menu' | 'dialog' | 'listbox'
}

/**
 * The one button of the editor. Every icon-only button gets a tooltip (`title`) AND an accessible name (`aria-label`); a disabled one
 * keeps its reason in both (UX 2.2: controls that do not apply are shown disabled with a one-line reason, never hidden).
 */
export function Btn({ children, icon: Icon, label, reason, onClick, pressed, variant = 'default', testId, className, expanded, haspopup }: BtnProps) {
  const reasonId = useId()
  const name = typeof children === 'string' ? children : label
  const tip = reason ? (name ? `${name}: ${reason}` : reason) : label
  return (
    <button
      type="button"
      className={`btn btn-${variant}${reason ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`}
      aria-disabled={reason ? true : undefined}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-haspopup={haspopup}
      aria-label={label}
      aria-describedby={reason ? reasonId : undefined}
      title={tip}
      data-testid={testId}
      onClick={reason ? (e) => e.preventDefault() : onClick}
    >
      {Icon && <Icon size={14} aria-hidden="true" />}
      {children}
      {reason && <span id={reasonId} className="sr-only">{reason}</span>}
    </button>
  )
}
