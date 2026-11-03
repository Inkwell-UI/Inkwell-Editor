import { useEffect, useRef } from 'react'
import { DIM, OVERSCAN, paintMenuBlur } from './menuBlur'

const MAX_WIDTH = 1920 // pixels: the blur is drawn once per size, and a bigger canvas only costs time

/** The picked image blurred like the game blurs the world behind a menu (`menuBlur.ts`). Fills its positioned parent; the parent clips the overscan. */
export function BlurredImage({ src, brightness }: { src: string; brightness: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const host = canvas?.parentElement
    if (!canvas || !host) return
    const img = new Image()
    const draw = (): void => {
      if (!img.naturalWidth || !host.clientWidth) return
      const scale = Math.min(window.devicePixelRatio || 1, MAX_WIDTH / (host.clientWidth * (1 + 2 * OVERSCAN)))
      canvas.width = Math.max(1, Math.round(host.clientWidth * (1 + 2 * OVERSCAN) * scale))
      canvas.height = Math.max(1, Math.round(host.clientHeight * (1 + 2 * OVERSCAN) * scale))
      paintMenuBlur(canvas, img)
    }
    img.onload = draw
    img.src = src
    // a paint takes ~150 ms at full size: while the panel is being dragged, redraw once it settles
    let timer: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(draw, 120)
    })
    ro.observe(host)
    return () => {
      ro.disconnect()
      clearTimeout(timer)
      img.onload = null
    }
  }, [src])
  return <canvas ref={ref} className="pv-blur-canvas" style={{ filter: `brightness(${brightness * DIM})` }} aria-hidden="true" />
}
