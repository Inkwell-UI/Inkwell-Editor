import { useState } from 'react'
import { editToPreview, TARGET_MS, type BuildRecord } from '../model/timingHistory'
import { formatMs, timingStages } from '../model/statusBar'
import { strings } from '../strings'

const CHART = { w: 336, h: 64, pad: 6, keep: 12 }

/** 1601 -> "1.6 s", 284 -> "284 ms". */
const short = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : formatMs(ms))

/** The last builds as a line with the edit-to-preview target drawn in; a tooltip on every build. */
function History({ builds }: { builds: BuildRecord[] }) {
  const [hover, setHover] = useState<number>()
  const totals = builds.map(editToPreview)
  const top = Math.max(TARGET_MS * 1.8, ...totals)
  const x = (i: number): number => (totals.length < 2 ? CHART.w / 2 : CHART.pad + (i / (totals.length - 1)) * (CHART.w - 2 * CHART.pad))
  const y = (v: number): number => CHART.h - CHART.pad - (v / top) * (CHART.h - 2 * CHART.pad)
  const step = totals.length < 2 ? CHART.w : (CHART.w - 2 * CHART.pad) / (totals.length - 1)
  const last = totals.length - 1
  const at = hover !== undefined ? builds[hover] : undefined
  const atMs = hover !== undefined ? totals[hover]! : 0
  return (
    <div className="bp-chart" style={{ width: CHART.w }}>
      <svg viewBox={`0 0 ${CHART.w} ${CHART.h}`} width={CHART.w} height={CHART.h} role="img" aria-label={strings.status.chartLabel(totals.length)}>
        <line x1={0} x2={CHART.w} y1={y(TARGET_MS)} y2={y(TARGET_MS)} className="bp-target" />
        <text x={CHART.w - 2} y={y(TARGET_MS) - 4} textAnchor="end" className="bp-target-label">{strings.status.targetLabel}</text>
        {totals.length > 1 && <polyline points={totals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} className="bp-line" />}
        <circle cx={x(last)} cy={y(totals[last]!)} r={4.5} className={`bp-end${totals[last]! > TARGET_MS ? ' over' : ''}`} />
        {hover !== undefined && <circle cx={x(hover)} cy={y(atMs)} r={4} className="bp-hover" />}
        {builds.map((b, i) => (
          <rect
            key={b.seq} x={x(i) - step / 2} y={0} width={step} height={CHART.h} fill="transparent" tabIndex={0}
            aria-label={`#${b.seq} ${b.swfName}: ${formatMs(totals[i]!)}`}
            onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onMouseLeave={() => setHover(undefined)} onBlur={() => setHover(undefined)}
          />
        ))}
      </svg>
      {at && (
        <div className="bp-tip" style={{ left: Math.min(Math.max(x(hover!), 80), CHART.w - 80), top: y(atMs) }}>
          #{at.seq} · {at.swfName} · <b className={`mono${atMs > TARGET_MS ? ' tone-warn' : ''}`}>{atMs > TARGET_MS ? '▲ ' : ''}{formatMs(atMs)}</b>
        </div>
      )}
      <div className="bp-axis"><span>{strings.status.oldest(totals.length)}</span><span>{strings.status.latest}</span></div>
    </div>
  )
}

/** The popup of the Build button: the last build as a total and one bar per stage, the recent builds as a chart (or, on request, a table). */
export function BuildPopup({ history, lastGoodAt, failed }: { history: BuildRecord[]; lastGoodAt: string | undefined; failed: boolean }) {
  const [table, setTable] = useState(false)
  const last = history.at(-1)
  if (!last) return <div className="details bp"><p className="empty">{strings.status.noBuilds}</p></div>
  const total = editToPreview(last)
  const stages = timingStages(last)
  const max = Math.max(...stages.map(([, v]) => v))
  const slowest = stages.find(([, v]) => v === max)?.[0]
  const recent = history.slice(-CHART.keep)
  return (
    <div className="details bp">
      <div className="bp-head">
        <span className="bp-total">{short(total)}</span>
        {total > TARGET_MS && <span className="bp-chip">{strings.status.overTarget}</span>}
      </div>
      <p className="bp-sub">
        <span data-testid="last-good" className={failed ? 'tone-error' : undefined}>
          {lastGoodAt ? `${strings.status.lastGoodBuild} ${lastGoodAt}` : strings.status.noGoodBuild}{failed && ` · ${strings.status.buildFailed}`}
        </span>
        {' · '}{last.swfName}
      </p>
      <div className="bp-stages">
        {stages.map(([n, v]) => (
          <div key={n} className="bp-stage">
            <span className="bp-l">{strings.status.stage(n)}</span>
            <span className="bp-t"><i className={n === slowest ? 'hi' : undefined} style={{ width: `${Math.max(1.5, (v / max) * 100)}%` }} /></span>
            <span className={`bp-v mono${n === slowest ? ' hi' : ''}`}>{formatMs(v)}</span>
          </div>
        ))}
      </div>
      <div className="bp-sep" />
      <h3>{strings.status.recent(recent.length)}</h3>
      {table ? (
        <div className="bp-hist">
          {[...history].reverse().map((r) => {
            const t = editToPreview(r)
            return (
              <div key={r.seq} className="bp-row">
                <span className="dim mono">#{r.seq}</span><span>{r.swfName}</span>
                <span className={`mono${t > TARGET_MS ? ' tone-warn' : ''}`}>{t > TARGET_MS ? '▲ ' : ''}{formatMs(t)}</span>
              </div>
            )
          })}
        </div>
      ) : <History builds={recent} />}
      <p className="bp-foot"><button type="button" className="bp-link" aria-pressed={table} onClick={() => setTable(!table)}>{table ? strings.status.showChart : strings.status.showTable}</button></p>
    </div>
  )
}
