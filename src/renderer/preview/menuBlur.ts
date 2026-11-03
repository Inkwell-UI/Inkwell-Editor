/**
 * The blur Skyrim puts behind a menu with the "Blur the background" flag, drawn on a canvas. Fitted to a sharp/blurred screenshot pair of the
 * same scene (1920x1080); the fit matches the detail left in every frequency band to within 1%. Three parts:
 *  - a round blur, strongest in the middle (CORE) and weaker toward the corners (EDGE),
 *  - a radial smear (zoom blur around the screen centre) that takes over toward the corners,
 *  - the picture comes out about 13% darker (DIM).
 * All sizes are shares of the picture width, so it looks the same at any size. A single CSS blur cannot do the smear.
 */
export const CORE = 4.6 / 1920
export const EDGE = 1.06 / 1920
/** Total scale range of the smear: the scene is averaged over scales 1 +- SMEAR / 2. */
export const SMEAR = 0.023
/** Distance from the centre (0 = centre, 1 = corner) where the edge look is fully in. */
export const FADE = 1.18
export const DIM = 0.866
/** The canvas is this much larger than the box on every side: the smear and the blur fade out at the borders, which stay outside the box. */
export const OVERSCAN = 0.03
const TAPS = 15

/** Weight of the edge look at `t` (0 centre .. 1 = FADE): a smoothstep. */
export const edgeWeight = (t: number): number => t * t * (3 - 2 * t)

/** Draws `img` (cover-fitted) blurred like the game onto `canvas`, at the canvas' own pixel size. */
export function paintMenuBlur(canvas: HTMLCanvasElement, img: CanvasImageSource & { naturalWidth: number; naturalHeight: number }): void {
  const w = canvas.width
  const h = canvas.height
  const layer = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return [c, c.getContext('2d')!]
  }
  const [src, sx] = layer()
  const fit = Math.max(w / img.naturalWidth, h / img.naturalHeight)
  sx.drawImage(img, (w - img.naturalWidth * fit) / 2, (h - img.naturalHeight * fit) / 2, img.naturalWidth * fit, img.naturalHeight * fit)

  // the edge look: a running average of the scene at TAPS scales around the centre, then a small round blur
  const [smear, mx] = layer()
  for (let i = 0; i < TAPS; i++) {
    const k = 1 + SMEAR * (i / (TAPS - 1) - 0.5)
    mx.globalAlpha = 1 / (i + 1)
    mx.setTransform(k, 0, 0, k, (w / 2) * (1 - k), (h / 2) * (1 - k))
    mx.drawImage(src, 0, 0)
  }
  const [edge, ex] = layer()
  ex.filter = `blur(${EDGE * w}px)`
  ex.drawImage(smear, 0, 0)
  ex.filter = 'none'
  // keep it only where the weight says so: an ellipse through the corners, so the distance is the same fraction of width and of height
  ex.globalCompositeOperation = 'destination-in'
  ex.translate(w / 2, h / 2)
  ex.scale(1, h / w)
  const g = ex.createRadialGradient(0, 0, 0, 0, 0, FADE * (w / 2) * Math.SQRT2)
  for (let j = 0; j <= 10; j++) g.addColorStop(j / 10, `rgba(0,0,0,${edgeWeight(j / 10)})`)
  ex.fillStyle = g
  ex.fillRect(-w, -w, 2 * w, 2 * w)

  const out = canvas.getContext('2d')!
  out.clearRect(0, 0, w, h)
  out.filter = `blur(${CORE * w}px)`
  out.drawImage(src, 0, 0)
  out.filter = 'none'
  out.drawImage(edge, 0, 0)
}
