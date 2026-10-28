import type { PointerEvent, WheelEvent } from 'react'

/** The canvas Ruffle draws on (inside its player element), found from a layer laid over the stage. */
const canvasOf = (overlay: HTMLElement | null): HTMLCanvasElement | null | undefined => overlay?.parentElement?.querySelector('ruffle-player')?.shadowRoot?.querySelector('canvas')

/**
 * Inspect and Focus Graph lay a layer over the stage that takes the pointer, so the SWF would never see the mouse. This hands it the mouse position and the wheel (the same events, at the same
 * client coordinates), so what the SWF does with them (hover, scrolling frames) works there too. Clicks are not forwarded: they select layers.
 */
export function forwardToStage(overlay: HTMLElement | null, e: PointerEvent | WheelEvent): void {
  const canvas = canvasOf(overlay)
  if (!canvas) return
  const at = { clientX: e.clientX, clientY: e.clientY, bubbles: true }
  if ('deltaY' in e) canvas.dispatchEvent(new WheelEvent('wheel', { ...at, deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode }))
  else canvas.dispatchEvent(new PointerEvent('pointermove', { ...at, pointerType: 'mouse' }))
}
