import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export interface PopoverProps {
  /** Renders the trigger; spread `props` on the button (aria + onClick). */
  trigger(props: { onClick(): void; 'aria-expanded': boolean; 'aria-controls': string; 'aria-haspopup': 'dialog' }, open: boolean): ReactNode
  children: ReactNode | ((close: () => void) => ReactNode)
  /** Where the panel opens relative to the trigger. */
  align?: 'start' | 'end'
  /** Opens upward (status bar). */
  up?: boolean
  label: string
  className?: string
}

/** A small anchored panel: closes on Escape, on a click outside, and when focus leaves it. No portal; positioned by CSS next to its trigger. */
export function Popover({ trigger, children, align = 'start', up, label, className }: PopoverProps) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [side, setSide] = useState(align)
  // keep the panel inside the window: if it overflows on the requested side, open it towards the other
  useLayoutEffect(() => {
    if (!open || !panel.current) return
    const r = panel.current.getBoundingClientRect()
    if (r.left < 0 && side === 'end') setSide('start')
    else if (r.right > window.innerWidth && side === 'start') setSide('end')
  }, [open, side])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false)
        root.current?.querySelector<HTMLElement>('[aria-controls]')?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={root} className={`popover-root${className ? ` ${className}` : ''}`}>
      {trigger({ onClick: () => setOpen(!open), 'aria-expanded': open, 'aria-controls': id, 'aria-haspopup': 'dialog' }, open)}
      {open && (
        <div ref={panel} id={id} role="dialog" aria-label={label} className={`popover popover-${side}${up ? ' popover-up' : ''}`}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  )
}
