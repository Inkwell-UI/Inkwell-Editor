import type { PointerEvent, WheelEvent } from 'react'

/** The frame the preview runs in (RuffleBackend) and the canvas Ruffle draws on inside it, found from a layer laid over the stage. */
function stageOf(overlay: HTMLElement | null): { frame: HTMLIFrameElement; canvas: HTMLCanvasElement } | undefined {
  const frame = overlay?.parentElement?.querySelector('iframe')
  const canvas = frame?.contentDocument?.querySelector('ruffle-player')?.shadowRoot?.querySelector('canvas')
  return frame && canvas ? { frame, canvas } : undefined
}

/**
 * Inspect and Focus Graph lay a layer over the stage that takes the pointer, so the SWF would never see the mouse. This hands it the mouse position and the wheel (the same events, at the same
 * place on the stage), so what the SWF does with them (hover, scrolling frames) works there too. Clicks are not forwarded: they select layers.
 */
export function forwardToStage(overlay: HTMLElement | null, e: PointerEvent | WheelEvent): void {
  const s = stageOf(overlay)
  if (!s) return
  const r = s.frame.getBoundingClientRect()
  const win = s.frame.contentWindow as unknown as { WheelEvent: typeof globalThis.WheelEvent; PointerEvent: typeof globalThis.PointerEvent }
  const at = { clientX: e.clientX - r.left, clientY: e.clientY - r.top, bubbles: true } // in the frame's own coordinates
  if ('deltaY' in e) s.canvas.dispatchEvent(new win.WheelEvent('wheel', { ...at, deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode }))
  else s.canvas.dispatchEvent(new win.PointerEvent('pointermove', { ...at, pointerType: 'mouse' }))
}
