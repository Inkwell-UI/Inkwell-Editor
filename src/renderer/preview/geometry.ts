export interface Size {
  width: number
  height: number
}
export interface Rect extends Size {
  x: number
  y: number
}

/**
 * Scaleform `showAll`: scale the stage uniformly so it fits entirely inside `box` and centre it; the rest of the box is the letterbox bars.
 * Degenerate (zero or negative) sizes give an empty rect with scale 0.
 */
export function fitStage(box: Size, stage: Size): Rect & { scale: number } {
  if (box.width <= 0 || box.height <= 0 || stage.width <= 0 || stage.height <= 0) return { x: 0, y: 0, width: 0, height: 0, scale: 0 }
  const scale = Math.min(box.width / stage.width, box.height / stage.height)
  const width = stage.width * scale
  const height = stage.height * scale
  return { x: (box.width - width) / 2, y: (box.height - height) / 2, width, height, scale }
}

/** Conventional broadcast safe areas, as the fraction of the screen that is safe: action-safe 93 %, title-safe 90 %. */
export const SAFE_ZONES = { action: 0.93, title: 0.9 } as const

/** Title- and action-safe rectangles for a screen box, in the box's own coordinates. */
export function safeRects(screen: Size): { title: Rect; action: Rect } {
  const inset = (f: number): Rect => ({ x: (screen.width * (1 - f)) / 2, y: (screen.height * (1 - f)) / 2, width: screen.width * f, height: screen.height * f })
  return { title: inset(SAFE_ZONES.title), action: inset(SAFE_ZONES.action) }
}

/** The screen box of a given aspect ratio (width / height) that fits inside `container`; the container's remainder is bars around the screen. */
export function screenBox(container: Size, aspect: number): Rect {
  const r = fitStage(container, { width: aspect * 1000, height: 1000 })
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

/** Zoom steps of the stage, as a fraction of "fit". */
export const ZOOM_STEPS = [0.5, 0.66, 0.8, 1, 1.25, 1.5, 2, 3, 4] as const

/** The next zoom step in `dir` (+1 in, -1 out); stays at the ends. A value between steps snaps to the next one in that direction. */
export function stepZoom(zoom: number, dir: 1 | -1): number {
  const eps = 1e-6
  const next = dir === 1 ? ZOOM_STEPS.find((z) => z > zoom + eps) : [...ZOOM_STEPS].reverse().find((z) => z < zoom - eps)
  return next ?? (dir === 1 ? ZOOM_STEPS.at(-1)! : ZOOM_STEPS[0])
}

/** A stage-space point from a pointer position: `rect` is where the stage sits on screen (fitStage + the screen's own offset). Undefined outside the stage. */
export function toStagePoint(client: { x: number; y: number }, origin: { x: number; y: number }, fit: Rect & { scale: number }): { x: number; y: number } | undefined {
  if (fit.scale <= 0) return undefined
  const x = (client.x - origin.x - fit.x) / fit.scale
  const y = (client.y - origin.y - fit.y) / fit.scale
  return x < 0 || y < 0 || x > fit.width / fit.scale || y > fit.height / fit.scale ? undefined : { x, y }
}
