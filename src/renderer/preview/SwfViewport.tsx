import { useEffect } from 'react'
import { useElementSize } from '../hooks/useElementSize'
import type { PreviewBackend } from './backend'
import { fitStage, type Size } from './geometry'

/** Props of SwfViewport. */
export interface SwfViewportProps {
  /** Shows the movie; its `element` is placed inside this viewport. */
  backend: PreviewBackend
  /** Design size of the movie in px. */
  stage: Size
}

/**
 * Fills its container with black and draws the backend's element at the stage's aspect ratio, as large as fits (showAll, letterboxed):
 * the bars are the black the container shows. The element is sized in real pixels (not CSS-scaled), so the player renders at screen resolution.
 */
export function SwfViewport({ backend, stage }: SwfViewportProps) {
  const [ref, box] = useElementSize<HTMLDivElement>()
  const fit = fitStage(box, stage)
  useEffect(() => {
    const host = ref.current
    if (!host) return
    host.appendChild(backend.element)
    return () => void backend.element.remove()
  }, [backend, ref])
  useEffect(() => {
    const s = backend.element.style
    s.position = 'absolute'
    s.left = `${fit.x}px`
    s.top = `${fit.y}px`
    s.width = `${fit.width}px`
    s.height = `${fit.height}px`
  }, [backend, fit.x, fit.y, fit.width, fit.height])
  return <div ref={ref} className="swf-viewport" />
}
