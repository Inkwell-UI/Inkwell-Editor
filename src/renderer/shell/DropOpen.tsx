import { useEffect, useState } from 'react'
import { strings } from '../../shared/strings'
import { inkwell } from '../hooks/api'
import { useToastStore } from '../state/toastStore'

const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes('Files')

/**
 * A folder dropped on the window opens as a project: main checks it is a directory with project.json (`openDroppedProject`) and ignores anything else, so a dropped image or
 * stray folder does nothing. Every file drop is cancelled here so Electron never navigates to it. Only files count: the app's own drags (functions, components) pass through.
 */
export function DropOpen() {
  const [over, setOver] = useState(false)
  useEffect(() => {
    let depth = 0
    const on = (t: string, f: (e: DragEvent) => void): (() => void) => (window.addEventListener(t, f as EventListener), () => window.removeEventListener(t, f as EventListener))
    const offs = [
      on('dragenter', (e) => hasFiles(e) && (depth++, setOver(true))),
      on('dragleave', (e) => hasFiles(e) && (depth = Math.max(0, depth - 1)) === 0 && setOver(false)),
      on('dragover', (e) => hasFiles(e) && e.preventDefault()),
      on('drop', (e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        depth = 0
        setOver(false)
        const paths = [...(e.dataTransfer?.files ?? [])].map((f) => inkwell?.pathOfFile(f) ?? '').filter(Boolean)
        void (async () => {
          for (const p of paths) {
            const r = await inkwell?.openDroppedProject(p)
            if (!r) return
            if (r.ok) return
            if (!('cancelled' in r)) return void useToastStore.getState().push({ tone: 'error', title: strings.drop.openFailed, text: r.error })
          }
        })()
      })
    ]
    return () => offs.forEach((f) => f())
  }, [])
  return over ? <div className="drop-veil" role="status">{strings.drop.project}</div> : null
}
