// 9-slice / 3-slice layout (PLAN-SLICING.md): the one place that decides where each piece of a sliced image goes. The compiler places the pieces with it,
// the Asset View previews with it, and the AS2 helper (`main/swf/sliceAs2.ts`) repeats the same arithmetic at run time (a test runs that AS2 against this).

/** Insets in source px and the source image size. A 3-slice has one pair at 0. */
export interface SliceInsets { l: number; t: number; r: number; b: number; w: number; h: number }

/** One piece: its source rectangle in the image, and where it goes in the box. `index` = row * 3 + column (the AS2 clip is `p<index>`). */
export interface SliceCell { index: number; sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number }

/**
 * One axis as [source start, source size, target start, target size] for the first fixed part, the stretchable middle and the last fixed part.
 * A box smaller than both fixed parts shrinks them by the same factor and the middle disappears (target size 0): never negative, never overlapping.
 */
export function sliceAxis(a: number, b: number, src: number, box: number): [number, number, number, number][] {
  const k = a + b > box && a + b > 0 ? box / (a + b) : 1
  const da = a * k, db = b * k
  return [[0, a, 0, da], [a, src - a - b, da, box - da - db], [src - b, b, box - db, db]]
}

/** The pieces for a box of `w` x `h`; cells whose source is empty (the rows of a horizontal 3-slice, say) are left out. */
export function sliceCells(s: SliceInsets, w: number, h: number): SliceCell[] {
  const xs = sliceAxis(s.l, s.r, s.w, w), ys = sliceAxis(s.t, s.b, s.h, h)
  const out: SliceCell[] = []
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      const [sx, sw, dx, dw] = xs[c]!, [sy, sh, dy, dh] = ys[r]!
      if (sw > 0 && sh > 0) out.push({ index: r * 3 + c, sx, sy, sw, sh, dx, dy, dw, dh })
    }
  return out
}
