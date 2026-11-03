import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

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

/** A small anchored panel: closes on Escape and on a click outside. Portaled to <body> and placed with `position: fixed` next to its trigger, so no panel's clipping or stacking context can hide it. */
export function Popover({ trigger, children, align = 'start', up, label, className }: PopoverProps) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  // align to the trigger's edge, open on the requested side or the other when it does not fit, then keep it inside the window
  const place = (): void => {
    const el = panel.current
    const t = root.current?.getBoundingClientRect()
    if (!el || !t) return
    const { width, height } = el.getBoundingClientRect()
    const gap = 4
    const fitsAbove = t.top - gap - height >= 0
    const fitsBelow = t.bottom + gap + height <= window.innerHeight
    const above = up ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove
    const top = above ? t.top - gap - height : t.bottom + gap
    const left = align === 'end' ? t.right - width : t.left
    el.style.left = `${Math.max(gap, Math.min(left, window.innerWidth - width - gap))}px`
    el.style.top = `${Math.max(gap, Math.min(top, window.innerHeight - height - gap))}px`
  }
  useLayoutEffect(() => {
    if (!open) return
    place()
    const ro = new ResizeObserver(place)
    if (panel.current) ro.observe(panel.current)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- place reads only props and refs
  }, [open, align, up])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!root.current?.contains(t) && !panel.current?.contains(t)) setOpen(false)
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
      {open &&
        createPortal(
          <div ref={panel} id={id} role="dialog" aria-label={label} className={`popover${className ? ` ${className}` : ''}`}>
            {typeof children === 'function' ? children(() => setOpen(false)) : children}
          </div>,
          document.body
        )}
    </div>
  )
}
