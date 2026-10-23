import { useState } from 'react'
import type { Swf } from '@inkwell-ui/spec'
import { useElementSize } from '../hooks/useElementSize'
import { computeBounds, hitTest } from '../model/hitTest'
import { fitStage, toStagePoint } from './geometry'

/** Props of InspectOverlay. */
export interface InspectOverlayProps {
  ir: Swf
  /** The stage size the SWF is fitted with (the same `stage` the SwfViewport gets). */
  stage: { width: number; height: number }
  /** Inspect: the overlay takes the pointer (hover outline, click selects). Play: it passes everything through to the SWF and draws nothing. */
  active: boolean
  selected: string | undefined
  onSelect(nodeId: string): void
}

/**
 * Transparent layer over the screen box, built from the IR geometry (not from the SWF): nodes' transforms give axis-aligned bounds, rotated
 * nodes use their rotated bounding box. Hover outlines the component under the pointer, a click selects it (selection model source `stage`),
 * the selected one keeps an outline. It only shows what Figma owns; nothing here moves or resizes anything.
 */
export function InspectOverlay({ ir, stage, active, selected, onSelect }: InspectOverlayProps) {
  const [ref, size] = useElementSize<HTMLDivElement>()
  const [hover, setHover] = useState<string>()
  const fit = fitStage(size, stage)
  const bounds = computeBounds(ir)

  const pick = (e: React.PointerEvent): string | undefined => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return undefined
    const p = toStagePoint({ x: e.clientX, y: e.clientY }, { x: r.left, y: r.top }, fit)
    return p ? hitTest(ir, p) : undefined
  }
  const outline = (id: string | undefined, cls: string): React.ReactNode => {
    const b = id ? bounds.get(id) : undefined
    if (!id || !b) return null
    return <div className={`inspect-outline ${cls}`} style={{ left: fit.x + b.x * fit.scale, top: fit.y + b.y * fit.scale, width: b.width * fit.scale, height: b.height * fit.scale }} data-node={id} />
  }
  return (
    <div
      ref={ref}
      className={`inspect-overlay${active ? ' is-active' : ''}`}
      data-testid="inspect-overlay"
      onPointerMove={active ? (e) => setHover(pick(e)) : undefined}
      onPointerLeave={active ? () => setHover(undefined) : undefined}
      onPointerDown={active ? (e) => { const id = pick(e); if (id) onSelect(id) } : undefined}
    >
      {active && hover !== selected && outline(hover, 'is-hover')}
      {active && outline(selected, 'is-selected')}
    </div>
  )
}
