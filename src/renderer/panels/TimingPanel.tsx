import { useSyncState } from '../hooks/useSyncState'
import { strings } from '../strings'
import { Panel } from './Panel'

const ms = (v: number): string => `${v.toFixed(1)} ${strings.overlayMs}`

/**
 * Dev overlay: every pipeline stage (sync, codegen, swf, ffdec, preview-build), the total, the renderer-measured preview time and
 * edit-to-preview (pipeline total + preview). Data: useSyncState().timing / .previewMs.
 */
export function TimingPanel() {
  const s = useSyncState()
  const t = s?.timing
  return (
    <Panel title={strings.panelTiming} collapsible>
      <div className="mono">
        {t ? (
          <>
            {Object.entries(t.stages).map(([name, v]) => (
              <div key={name}>{name}: {ms(v)}</div>
            ))}
            <div>{strings.overlayTotal}: {ms(t.total)}</div>
            <div>{strings.timingPreview}: {s?.previewMs === undefined ? strings.timingNotMeasured : ms(s.previewMs)}</div>
            {s?.previewMs !== undefined && (
              <div>
                <strong>{strings.timingEditToPreview}: {ms(t.total + s.previewMs)}</strong>
              </div>
            )}
          </>
        ) : (
          <div>{strings.overlayNoBuilds}</div>
        )}
      </div>
      <p className="note">{strings.timingEditToPreviewNote}</p>
    </Panel>
  )
}
