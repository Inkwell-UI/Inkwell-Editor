import { useEffect, useState } from 'react'
import type { PreviewBuild } from '../../shared/preview'
import { inkwell } from './api'

/** A SWF's latest preview build plus the last one that had bytes ("last good build"). */
export interface StageEntry {
  /** What the stage shows: the latest build if it has a SWF, else the last good one (never blank once something built). */
  shown: PreviewBuild | undefined
  latest: PreviewBuild
  /** True when `latest` has no SWF (the preview build failed) and `shown` is an older one (or nothing). */
  stale: boolean
  /** When `shown` arrived (ms since epoch), for the "last good build" time. */
  shownAt: number | undefined
}

/**
 * The stage's builds, one per SWF sorted by name. RESTORE HOOK: after a reload the main process still holds the latest builds and
 * `getPreviewBuilds()` returns them, so the preview comes back without a Figma change. When mock data exists, feed it in here (or replace
 * `getPreviewBuilds` in the preload API) and every preview consumer follows.
 * LAST GOOD BUILD: a build without bytes never replaces the shown one (UX 4.3 item 7).
 */
export function usePreviewBuilds(): StageEntry[] {
  const [entries, setEntries] = useState<StageEntry[]>([])
  useEffect(() => {
    const merge = (b: PreviewBuild): void =>
      setEntries((cur) => {
        const old = cur.find((c) => c.latest.swfId === b.swfId)
        const good = b.bytes ? { shown: b, shownAt: Date.now() } : { shown: old?.shown, shownAt: old?.shownAt }
        const next: StageEntry = { latest: b, stale: !b.bytes, ...good }
        return [...cur.filter((c) => c.latest.swfId !== b.swfId), next].sort((x, y) => x.latest.name.localeCompare(y.latest.name))
      })
    let live = true
    void inkwell?.getPreviewBuilds().then((all) => live && all.forEach(merge))
    const off = inkwell?.onPreviewBuild(merge)
    return () => {
      live = false
      off?.()
    }
  }, [])
  return entries
}
