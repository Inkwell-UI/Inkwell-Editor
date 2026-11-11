import { useEffect } from 'react'
import { useProject } from '../hooks/useProject'
import { useSyncState } from '../hooks/useSyncState'
import { useSliceStore } from '../state/sliceStore'
import { strings } from '../../shared/strings'
import { Panel } from './Panel'

/** Assets mode, left: every image of the project as a thumbnail; the selected one is edited in the Slice panel. Refreshes when a build finishes (a sync can bring new images). */
export function AssetListPanel() {
  const dir = useProject()?.dir
  const seq = useSyncState()?.buildSeq
  const { assets, slices, selected, select, load } = useSliceStore()
  useEffect(() => void (dir && load()), [dir, seq, load])
  const t = strings.assetView
  return (
    <Panel title={t.listTitle}>
      {assets.length === 0 ? (
        <p className="empty">{t.none}</p>
      ) : (
        <ul className="asv-list" aria-label={t.listTitle}>
          {assets.map((a) => (
            <li key={a.hash}>
              <button type="button" className={`asv-thumb${a.hash === selected ? ' is-selected' : ''}`} aria-pressed={a.hash === selected} onClick={() => select(a.hash)} title={a.hash}>
                <span className="asv-thumb-img"><img src={a.dataUrl} alt="" draggable={false} /></span>
                <span className="asv-thumb-meta">
                  <span>{t.size(a.width, a.height)}</span>
                  <span className="asv-thumb-chips">
                    {slices?.assets[a.hash] && <span className="chip chip-ok">{t.sliced}</span>}
                    {a.usedBy.length === 0 && <span className="chip">{t.unused}</span>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
