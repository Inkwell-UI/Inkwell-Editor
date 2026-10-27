import { useState } from 'react'
import { FOCUS_DIRS, focusGraph, type FocusDir, type Swf } from '@inkwell-ui/spec'
import { useElementSize } from '../hooks/useElementSize'
import { useActiveOverlay, useDockRows } from '../hooks/useProject'
import { computeBounds, hitTest } from '../model/hitTest'
import { editNode, editOverlay } from '../state/overlayStore'
import { patchNodeOverlay } from '../../shared/overlay'
import { strings } from '../strings'
import { fitStage, toStagePoint } from './geometry'

/** Props of FocusGraphOverlay. */
export interface FocusGraphOverlayProps {
  ir: Swf
  swfId: string
  swfName: string
  stage: { width: number; height: number }
  /** Inspect mode: clicks and drags edit the graph. Play mode: it only draws. */
  active: boolean
  onSelect(nodeId: string): void
}

/** The nearest frame (a MovieClip in the SWF) at or above `id`, never the root: only clips can take focus. */
function clipOf(ir: Swf, id: string | undefined): string | undefined {
  for (let n = id ? ir.nodes[id] : undefined; n && n.id !== ir.root; n = n.parent ? ir.nodes[n.parent] : undefined) if (n.type === 'frame') return n.id
  return undefined
}

/** Drag direction: the dominant axis of the stage-space vector. */
export const dragDir = (dx: number, dy: number): FocusDir => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up')

/**
 * The stage toolbar's Focus Graph mode (W3, UX 4.3 item 4): order badges on the focusable components and an arrow per override. In Inspect mode a click on a component adds it to
 * the end of the focus order (Alt+click removes it), a drag from one component to another sets the override of the drag's direction. Badges of a component with a focus lint row
 * (from the build, the one validation source) are drawn as errors. Every edit is one overlay undo entry.
 */
export function FocusGraphOverlay({ ir, swfId, swfName, stage, active, onSelect }: FocusGraphOverlayProps) {
  const [ref, size] = useElementSize<HTMLDivElement>()
  const [drag, setDrag] = useState<{ from: string; x: number; y: number }>()
  const overlay = useActiveOverlay()
  const rows = useDockRows()
  const fit = fitStage(size, stage)
  const bounds = computeBounds(ir)
  const nodes = (overlay?.nodes ?? {}) as Record<string, { focus?: { order?: number; overrides?: Record<string, string> } & Record<string, unknown> }>
  const g = focusGraph(nodes, (id) => id in ir.nodes)
  const bad = new Set(rows.filter((r) => r.swfName === swfName && r.code.startsWith('focus-') && r.severity === 'error' && r.nodeId).map((r) => r.nodeId!))
  const center = (id: string): { x: number; y: number } | undefined => {
    const b = bounds.get(id)
    return b ? { x: fit.x + (b.x + b.width / 2) * fit.scale, y: fit.y + (b.y + b.height / 2) * fit.scale } : undefined
  }
  const local = (e: React.PointerEvent): { x: number; y: number } => {
    const r = ref.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const pick = (e: React.PointerEvent): string | undefined => {
    const r = ref.current?.getBoundingClientRect()
    const p = r ? toStagePoint({ x: e.clientX, y: e.clientY }, { x: r.left, y: r.top }, fit) : undefined
    return p ? clipOf(ir, hitTest(ir, p)) : undefined
  }
  const nextOrder = (): number => Math.max(0, ...g.order.map((id) => nodes[id]!.focus!.order!)) + 1
  const up = (e: React.PointerEvent): void => {
    const from = drag?.from
    setDrag(undefined)
    const to = pick(e)
    if (!from || !to) return
    const f = nodes[from]?.focus ?? {}
    if (to === from) {
      if (e.altKey) {
        const { order: _o, overrides: _v, ...rest } = f
        editNode(swfId, from, { focus: Object.keys(rest).length ? rest : null })
      } else if (typeof f.order !== 'number') editNode(swfId, from, { focus: { ...f, order: nextOrder() } })
      onSelect(from)
      return
    }
    const a = center(from)
    const b = center(to)
    if (!a || !b || typeof f.order !== 'number') return
    // one undo entry: the target joins the order (if it was not in it) and the override is set
    editOverlay(swfId, (doc) => {
      const withTarget = typeof nodes[to]?.focus?.order === 'number' ? doc : patchNodeOverlay(doc, to, { focus: { ...nodes[to]?.focus, order: nextOrder() } })
      return patchNodeOverlay(withTarget, from, { focus: { ...f, overrides: { ...f.overrides, [dragDir(b.x - a.x, b.y - a.y)]: to } } })
    })
  }

  return (
    <div
      ref={ref}
      className={`focus-overlay${active ? ' is-active' : ''}`}
      data-testid="focus-overlay"
      onPointerDown={active ? (e) => { const id = pick(e); if (id) (e.currentTarget.setPointerCapture(e.pointerId), setDrag({ from: id, ...local(e) })) } : undefined}
      onPointerMove={drag ? (e) => setDrag({ ...drag, ...local(e) }) : undefined}
      onPointerUp={active ? up : undefined}
    >
      <svg className="focus-svg" width={size.width} height={size.height} aria-hidden="true">
        <defs>
          <marker id="focus-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="focus-head" /></marker>
        </defs>
        {g.order.flatMap((id) =>
          FOCUS_DIRS.filter((d) => nodes[id]?.focus?.overrides?.[d] && g.moves[id]![d] === nodes[id]!.focus!.overrides![d]).map((d) => {
            const a = center(id)
            const b = center(g.moves[id]![d])
            if (!a || !b) return null
            return (
              <g key={`${id}-${d}`}>
                <title>{strings.stage.focusArrow(d)}</title>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="focus-arrow" markerEnd="url(#focus-head)" />
                <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} className="focus-dir">{d}</text>
              </g>
            )
          })
        )}
        {drag && center(drag.from) && <line x1={center(drag.from)!.x} y1={center(drag.from)!.y} x2={drag.x} y2={drag.y} className="focus-arrow is-drag" markerEnd="url(#focus-head)" />}
      </svg>
      {g.order.map((id, k) => {
        const b = bounds.get(id)
        if (!b) return null
        return (
          <span key={id} className={`focus-badge${bad.has(id) ? ' is-error' : ''}`} style={{ left: fit.x + b.x * fit.scale, top: fit.y + b.y * fit.scale }} title={strings.stage.focusBadge(k + 1)} data-node={id}>
            {k + 1}
          </span>
        )
      })}
    </div>
  )
}
