// Synthetic test images (no binaries in the repo): coloured quadrants, an alpha ramp and a corner marker, so orientation, scaling and alpha are visible.
import { createHash } from 'node:crypto'
import { encodePng, type Rgba } from './png'

/**
 * Quadrants red / green (top), blue / white (bottom); alpha rises from 64 at the left edge to 255 at the right;
 * an opaque black triangle marks the top-left corner; a 1 px opaque yellow border shows the exact edges.
 */
export function syntheticImage(width: number, height: number): Rgba {
  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      const right = x >= width / 2, bottom = y >= height / 2
      let c = !bottom ? (right ? [40, 200, 70] : [220, 50, 50]) : right ? [245, 245, 245] : [50, 90, 230]
      let a = Math.round(64 + (191 * x) / Math.max(1, width - 1))
      if (x + y < Math.min(width, height) / 4) (c = [0, 0, 0]), (a = 255)
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) (c = [255, 220, 0]), (a = 255)
      rgba[o] = c[0]!
      rgba[o + 1] = c[1]!
      rgba[o + 2] = c[2]!
      rgba[o + 3] = a
    }
  return { width, height, rgba }
}

/** PNG bytes and a Figma-style hash (SHA-1 of the bytes, 40 hex digits). */
export function syntheticPng(width: number, height: number): { png: Buffer; hash: string; image: Rgba } {
  const image = syntheticImage(width, height)
  const png = encodePng(image)
  return { png, hash: createHash('sha1').update(png).digest('hex'), image }
}

/**
 * A 9-slice test image: the cells outside the insets (l, t, r, b px) are drawn so that stretching shows at once.
 * Corners: orange, round (transparent outside a quarter circle) with a white dot; edges: teal with a 2 px white line along the edge;
 * centre: a `check` px checkerboard; a 1 px yellow border. Correct slicing keeps corners round and the same size.
 */
export function syntheticSlice(width: number, height: number, ins: { l: number; t: number; r: number; b: number }, check = 8): { png: Buffer; hash: string; image: Rgba } {
  const rgba = Buffer.alloc(width * height * 4)
  const { l, t, r, b } = ins
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const xr = x < l ? 0 : x >= width - r ? 2 : 1, yr = y < t ? 0 : y >= height - b ? 2 : 1
      let c: number[], a = 255
      if (xr !== 1 && yr !== 1) {
        const cx = xr === 0 ? l : width - r, cy = yr === 0 ? t : height - b // the inner corner of the cell: the quarter circle is centred there
        const rad = Math.min(xr === 0 ? l : r, yr === 0 ? t : b)
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > rad) a = 0
        c = Math.hypot(x + 0.5 - (xr === 0 ? l / 2 : width - r / 2), y + 0.5 - (yr === 0 ? t / 2 : height - b / 2)) < 3 ? [255, 255, 255] : [240, 140, 30]
      } else if (xr === 1 && yr === 1) c = (Math.floor(x / check) + Math.floor(y / check)) % 2 ? [70, 80, 140] : [50, 60, 110]
      else {
        const across = xr === 1 ? y : x, mid = xr === 1 ? (yr === 0 ? t / 2 : height - b / 2) : (xr === 0 ? l / 2 : width - r / 2)
        c = Math.abs(across + 0.5 - mid) < 1 ? [255, 255, 255] : [40, 160, 170]
      }
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) (c = [255, 220, 0]), (a = a ? 255 : 0)
      const o = (y * width + x) * 4
      rgba[o] = c[0]!; rgba[o + 1] = c[1]!; rgba[o + 2] = c[2]!; rgba[o + 3] = a
    }
  const image = { width, height, rgba }
  const png = encodePng(image)
  return { png, hash: createHash('sha1').update(png).digest('hex'), image }
}
