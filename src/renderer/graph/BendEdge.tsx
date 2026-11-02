import { BaseEdge, useReactFlow, type EdgeProps } from '@xyflow/react'
import { useContext } from 'react'
import { bendIndex, bendPath, readBends, type Pt } from '../model/wireBends'
import { GraphContext } from './NodeView'

/** HaloEdge's selection halo: the selection colour of a node, wide enough to read around the line. */
const HALO = { stroke: 'var(--kw-select-soft)', strokeWidth: 10 }

/**
 * The wire with its optional bend points (`extra.bends` on the graph edge, layout only, never compiled): double-click the wire to add a dot,
 * drag a dot to move it, double-click a dot to remove it. Dots are canvas positions; a drag is one undo entry (beginDrag/endDrag).
 */
export function BendEdge({ id, data, selected, style, markerEnd, markerStart, interactionWidth, sourceX, sourceY, targetX, targetY }: EdgeProps) {
  const store = useContext(GraphContext)?.store
  const rf = useReactFlow()
  const start = { x: sourceX, y: sourceY }
  const end = { x: targetX, y: targetY }
  const bends = readBends((data as { extra?: unknown } | undefined)?.extra)
  const path = bendPath(start, bends, end)
  const at = (e: { clientX: number; clientY: number }): Pt => rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })

  const add = (e: React.MouseEvent): void => {
    if (!store) return
    const p = at(e)
    const i = bendIndex(start, bends, end, p)
    store.getState().setBends(id, [...bends.slice(0, i), p, ...bends.slice(i)])
  }
  const drag = (i: number) => (e: React.PointerEvent<SVGCircleElement>): void => {
    if (!store || e.button !== 0) return
    e.stopPropagation()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    store.getState().beginDrag()
    const move = (m: PointerEvent): void => store.getState().setBends(id, bends.map((b, j) => (j === i ? at(m) : b)))
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      store.getState().endDrag()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  return (
    <>
      {selected && <path d={path} fill="none" strokeLinecap="round" pointerEvents="none" style={HALO} />}
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} markerStart={markerStart} interactionWidth={interactionWidth} />
      <path d={path} fill="none" strokeOpacity={0} strokeWidth={interactionWidth ?? 20} className="react-flow__edge-interaction" onDoubleClick={add} />
      {bends.map((b, i) => (
        <circle
          key={i} cx={b.x} cy={b.y} r={5} className="gw-bend nodrag nopan"
          onPointerDown={drag(i)}
          onDoubleClick={(e) => { e.stopPropagation(); store?.getState().setBends(id, bends.filter((_, j) => j !== i)) }}
        />
      ))}
    </>
  )
}
