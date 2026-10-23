import { useEffect, useState } from 'react'
import type { PreviewBuild } from '../../shared/preview'
import { inkwell } from './api'

/**
 * The latest preview build of every SWF, sorted by name. RESTORE HOOK: after a reload the main process still holds the latest builds and
 * `getPreviewBuilds()` returns them, so the preview comes back without a Figma change. When mock data exists, feed it in here (or replace
 * `getPreviewBuilds` in the preload API) and every preview consumer follows.
 */
export function usePreviewBuilds(): PreviewBuild[] {
  const [builds, setBuilds] = useState<PreviewBuild[]>([])
  useEffect(() => {
    const merge = (b: PreviewBuild): void => setBuilds((cur) => [...cur.filter((c) => c.swfId !== b.swfId), b].sort((x, y) => x.name.localeCompare(y.name)))
    let live = true
    void inkwell?.getPreviewBuilds().then((all) => live && all.forEach(merge))
    const off = inkwell?.onPreviewBuild(merge)
    return () => {
      live = false
      off?.()
    }
  }, [])
  return builds
}
