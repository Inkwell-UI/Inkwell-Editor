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
