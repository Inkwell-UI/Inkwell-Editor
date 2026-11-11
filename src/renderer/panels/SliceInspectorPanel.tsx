import { Columns3, Grid3x3, Rows3, Trash2 } from 'lucide-react'
import { useProject } from '../hooks/useProject'
import { useProjectStore } from '../state/projectStore'
import { useSelectionStore } from '../state/selectionStore'
import { useSliceStore } from '../state/sliceStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { strings } from '../../shared/strings'
import { Btn } from '../ui/Btn'
import { InspCard, InspFoot, InspHeader } from '../ui/InspParts'
import { Panel } from './Panel'

/** Assets mode, right: the selected image in the shared Inspector shape (header, Preset card, Used by card, ID footer). */
export function SliceInspectorPanel() {
  const { assets, slices, selected, preset } = useSliceStore()
  const project = useProject()
  const a = assets.find((x) => x.hash === selected)
  const t = strings.assetView
  if (!a) {
    return (
      <Panel title={t.inspectorTitle}>
        <p className="empty">{assets.length ? t.pick : t.none}</p>
      </Panel>
    )
  }
  const goTo = (swfName: string, nodeId: string): void => {
    const swf = project?.swfs.find((s) => s.name === swfName)
    if (swf) useProjectStore.getState().setActiveSwf(swf.id)
    useWorkspaceStore.getState().setActive('layout')
    useSelectionStore.getState().selectComponent(nodeId, 'navigator')
  }
  return (
    <Panel title={t.inspectorTitle}>
      <div className="insp insp-fill">
        <InspHeader title={t.imageName} sub={`${t.size(a.width, a.height)} · ${slices?.assets[a.hash] ? t.slicedLine : t.notSlicedLine}`} />
        <InspCard title={t.presetTitle}>
          <div className="asv-presets">
            <Btn icon={Grid3x3} label={t.presets.nine} onClick={() => preset('nine')} />
            <Btn icon={Columns3} label={t.presets.horizontal} onClick={() => preset('horizontal')} />
            <Btn icon={Rows3} label={t.presets.vertical} onClick={() => preset('vertical')} />
            <Btn icon={Trash2} variant="quiet" className="btn-hover-err" label={t.presets.clear} reason={slices?.assets[a.hash] ? undefined : t.nothingToClear} onClick={() => preset('clear')} />
          </div>
        </InspCard>
        <InspCard title={t.usedByTitle(a.usedBy.length)}>
          {a.usedBy.length === 0 ? (
            <p className="dim">{t.usedByNone}</p>
          ) : (
            <ul className="asv-used">
              {a.usedBy.map((u) => (
                <li key={`${u.swf}/${u.nodeId}`}>
                  <button type="button" className="asv-used-row" onClick={() => goTo(u.swf, u.nodeId)}>
                    <span>{u.name}</span>
                    <span className="asv-dim">{u.swf}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </InspCard>
        <InspFoot text={a.hash.slice(0, 12)} title={a.hash} copy={a.hash} />
      </div>
    </Panel>
  )
}
