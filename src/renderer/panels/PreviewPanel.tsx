import { useEffect, useState, useSyncExternalStore } from 'react'
import type { AspectId } from '../../shared/preview'
import { inkwell } from '../hooks/api'
import { usePreviewBuilds } from '../hooks/usePreviewBuilds'
import { AspectFrame } from '../preview/AspectFrame'
import { createPreviewController, type PreviewController } from '../preview/controller'
import { PreviewToolbar } from '../preview/PreviewToolbar'
import { RuffleBackend } from '../preview/RuffleBackend'
import { SafeZoneOverlay } from '../preview/SafeZoneOverlay'
import { ShimBadge } from '../preview/ShimBadge'
import { SwfViewport } from '../preview/SwfViewport'
import { strings } from '../strings'
import { Panel } from './Panel'

const idle = { status: 'idle' as const }

/**
 * The live preview: toolbar (SWF, aspect ratio, safe zones, reload), the simulated screen with the stage fitted inside, and the Ruffle
 * notice. Data: usePreviewBuilds(). UI state (aspect, safe zones, selected SWF) is not persisted yet.
 * The backend is created here (RuffleBackend is the only 1.0 implementation; swap the line to plug in another PreviewBackend).
 */
export function PreviewPanel() {
  const builds = usePreviewBuilds()
  const [swfId, setSwfId] = useState<string>()
  const [aspect, setAspect] = useState<AspectId>('16:9')
  const [safe, setSafe] = useState(true)
  const [ctl, setCtl] = useState<PreviewController>()

  useEffect(() => {
    const c = createPreviewController({ backend: new RuffleBackend(), report: (r) => inkwell?.reportPreviewRendered(r) })
    setCtl(c)
    return () => c.dispose()
  }, [])

  const build = builds.find((b) => b.swfId === swfId) ?? builds[0]
  useEffect(() => {
    if (ctl && build) void ctl.show(build)
  }, [ctl, build])

  const state = useSyncExternalStore(ctl?.subscribe ?? (() => () => {}), ctl?.getState ?? (() => idle))

  return (
    <Panel title={strings.panelPreview}>
      <div className="preview-panel">
        <PreviewToolbar aspect={aspect} onAspect={setAspect} safeZones={safe} onSafeZones={setSafe} onReload={() => void ctl?.reload()}>
          {builds.length > 1 && (
            <label>
              {strings.previewSwf}{' '}
              <select value={build?.swfId} onChange={(e) => setSwfId(e.target.value)}>
                {builds.map((b) => <option key={b.swfId} value={b.swfId}>{b.name}</option>)}
              </select>
            </label>
          )}
        </PreviewToolbar>
        <div className="preview-stage">
          {ctl && build?.bytes ? (
            <AspectFrame aspect={aspect}>
              <SwfViewport backend={ctl.backend} stage={build.stage} />
              <SafeZoneOverlay visible={safe} />
            </AspectFrame>
          ) : (
            <p className="preview-message">{build ? `${strings.previewError}: ${build.error ?? ''}` : strings.previewNone}</p>
          )}
          {state.status === 'loading' && <p className="preview-status">{strings.previewLoading}</p>}
          {state.status === 'error' && build?.bytes && <p className="preview-message">{strings.previewError}: {state.error}</p>}
        </div>
        <ShimBadge {...(build ? { notes: build.notes } : {})} />
      </div>
    </Panel>
  )
}
