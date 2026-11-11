import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { Columns2, Eye, Image, ZoomIn, ZoomOut, type LucideIcon } from 'lucide-react'
import { useSliceStore, type Ins, type Side } from '../state/sliceStore'
import { sliceCells } from '../../shared/slice'
import { strings } from '../../shared/strings'
import type { AssetInfo } from '../../shared/assetsInfo'
import { Btn } from '../ui/Btn'
import { Panel } from './Panel'

const SIDES: Side[] = ['l', 't', 'r', 'b']
const VIEWS = ['source', 'result', 'both'] as const
const VIEW_ICON: Record<(typeof VIEWS)[number], LucideIcon> = { source: Image, result: Eye, both: Columns2 }
type View = (typeof VIEWS)[number]
const PAD = 16
const GAP = 24
const BAR_ROOM = 76 // the floating edge bar sits over the bottom of the canvas
const CAPTION = 24 // a figure caption and its gap
const MAX_SCALE = 8

/** The picture drawn as the compiler draws it: one element per piece, from the same `sliceCells` (src/shared/slice.ts), at `scale` screen px per image px. */
function SliceResult({ a, ins, w, h, scale, onResize }: { a: AssetInfo; ins: Ins; w: number; h: number; scale: number; onResize: (e: PointerEvent<HTMLElement>) => void }) {
  const piece = (c: ReturnType<typeof sliceCells>[number]): CSSProperties => ({
    left: c.dx * scale,
    top: c.dy * scale,
    width: c.dw * scale,
    height: c.dh * scale,
    backgroundImage: `url(${a.dataUrl})`,
    backgroundSize: `${((a.width * c.dw) / c.sw) * scale}px ${((a.height * c.dh) / c.sh) * scale}px`,
    backgroundPosition: `${((-c.sx * c.dw) / c.sw) * scale}px ${((-c.sy * c.dh) / c.sh) * scale}px`
  })
  return (
    <div className="asv-stage asv-result" style={{ width: w * scale, height: h * scale }} role="img" aria-label={strings.assetView.resultLabel(Math.round(w), Math.round(h))}>
      {sliceCells({ ...ins, w: a.width, h: a.height }, w, h).map((c) => (
        <span key={c.index} className="asv-prev-piece" style={piece(c)} />
      ))}
      <span className="asv-handle" onPointerDown={onResize} role="separator" aria-label={strings.assetView.resultHandle} title={strings.assetView.resultHandle} />
    </div>
  )
}

/** Assets mode, centre: the selected image as a big canvas (Source with four draggable guides, Result as the game draws it at a size you drag, or both), with the four edge numbers in a bar over the canvas. */
export function SliceEditorPanel() {
  const { assets, selected, error, ins, setSide, commit } = useSliceStore()
  const a = assets.find((x) => x.hash === selected)
  const t = strings.assetView
  const [view, setView] = useState<View>('both')
  const [zoom, setZoom] = useState<number | null>(null) // null = fit
  const [custom, setCustom] = useState<{ hash: string; w: number; h: number } | null>(null) // result size in image px once dragged
  const area = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = area.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [a === undefined])
  useEffect(() => setZoom(null), [a?.hash])

  if (!a) {
    return (
      <Panel title={t.editorTitle}>
        <p className="empty">{assets.length ? t.pick : t.none}</p>
      </Panel>
    )
  }

  const fixedW = ins.l + ins.r
  const fixedH = ins.t + ins.b
  const mine = custom?.hash === a.hash ? custom : null
  const rw = mine?.w ?? Math.max(fixedW + 8, Math.round(a.width * 0.5))
  const rh = mine?.h ?? Math.max(fixedH + 8, Math.round(a.height * 0.5))
  const showSrc = view !== 'result'
  const showRes = view !== 'source'
  const totalW = (showSrc ? a.width : 0) + (showRes ? rw : 0)
  const fit = Math.min((box.w - 2 * PAD - (view === 'both' ? GAP : 0)) / totalW, (box.h - 2 * PAD - BAR_ROOM - CAPTION) / Math.max(showSrc ? a.height : 0, showRes ? rh : 0))
  const scale = Math.max(0.01, Math.min(MAX_SCALE, zoom ?? (Number.isFinite(fit) && fit > 0 ? fit : 0.1)))

  // a guide moves with the pointer in image px; the value is saved when the pointer is released
  const drag = (side: Side) => (e: PointerEvent<HTMLElement>): void => {
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const stage = el.parentElement!.getBoundingClientRect()
    const move = (ev: globalThis.PointerEvent): void => {
      const x = (ev.clientX - stage.left) / scale
      const y = (ev.clientY - stage.top) / scale
      setSide(side, side === 'l' ? x : side === 'r' ? a.width - x : side === 't' ? y : a.height - y)
    }
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      commit()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  const resize = (e: PointerEvent<HTMLElement>): void => {
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const x0 = e.clientX, y0 = e.clientY, w0 = rw, h0 = rh
    const move = (ev: globalThis.PointerEvent): void =>
      setCustom({ hash: a.hash, w: Math.max(fixedW + 1, Math.round(w0 + (ev.clientX - x0) / scale)), h: Math.max(fixedH + 1, Math.round(h0 + (ev.clientY - y0) / scale)) })
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  const pos = (side: Side): CSSProperties =>
    side === 'l' ? { left: ins.l * scale } : side === 'r' ? { left: (a.width - ins.r) * scale } : side === 't' ? { top: ins.t * scale } : { top: (a.height - ins.b) * scale }

  const actions = (
    <>
      <span className="seg" role="group" aria-label={t.viewLabel}>
        {VIEWS.map((v) => (
          <Btn key={v} icon={VIEW_ICON[v]} label={t.views[v]} pressed={view === v} className="btn-seg" testId={`asv-view-${v}`} onClick={() => setView(v)} />
        ))}
      </span>
      <Btn icon={ZoomOut} label={strings.stage.zoomOut} variant="quiet" onClick={() => setZoom(scale / 1.25)} />
      <button type="button" className="btn btn-quiet zoom-value" onClick={() => setZoom(null)} title={strings.stage.zoomReset} aria-label={strings.stage.zoomReset}>{t.zoomPct(Math.round(scale * 100))}</button>
      <Btn icon={ZoomIn} label={strings.stage.zoomIn} variant="quiet" onClick={() => setZoom(scale * 1.25)} />
    </>
  )

  return (
    <Panel title={t.editorTitle} actions={actions}>
      <div className="asv-wrap">
        {error && <p className="empty">{t.loadError(error)}</p>}
        <div className="asv-canvas" ref={area}>
          <div className="asv-views" style={{ padding: PAD, paddingBottom: PAD + BAR_ROOM }}>
            {showSrc && (
              <figure className="asv-fig">
                <div className="asv-stage" style={{ width: a.width * scale, height: a.height * scale }}>
                  <img src={a.dataUrl} alt="" draggable={false} style={{ width: a.width * scale, height: a.height * scale }} />
                  {SIDES.map((side) => (
                    <span key={side} className={`asv-guide asv-guide-${side === 'l' || side === 'r' ? 'v' : 'h'}`} style={pos(side)} onPointerDown={drag(side)} role="separator" aria-label={t.guide(t.fields[side])} />
                  ))}
                </div>
                <figcaption>{t.sourceLabel(a.width, a.height)}</figcaption>
              </figure>
            )}
            {showRes && (
              <figure className="asv-fig">
                <SliceResult a={a} ins={ins} w={rw} h={rh} scale={scale} onResize={resize} />
                <figcaption>{t.resultLabel(rw, rh)}</figcaption>
              </figure>
            )}
          </div>
        </div>
        <div className="asv-bar">
          {SIDES.map((side) => (
            <label key={side} className="asv-field">
              <span>{t.fields[side]}</span>
              <input type="number" min={0} max={side === 'l' || side === 'r' ? a.width : a.height} value={ins[side]} onChange={(e) => setSide(side, e.target.valueAsNumber)} onBlur={() => commit()} onKeyDown={(e) => e.key === 'Enter' && commit()} />
            </label>
          ))}
        </div>
      </div>
    </Panel>
  )
}
