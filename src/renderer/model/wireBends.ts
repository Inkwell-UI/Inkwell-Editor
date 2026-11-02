export interface Pt { x: number; y: number }

/** The wire through its bend points: a horizontal-tangent curve per leg, like the default wire. */
export function bendPath(start: Pt, bends: Pt[], end: Pt): string {
  const pts = [start, ...bends, end]
  let d = `M${start.x},${start.y}`
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!
    const b = pts[i]!
    const k = Math.max(Math.abs(b.x - a.x) / 2, 30)
    d += ` C${a.x + k},${a.y} ${b.x - k},${b.y} ${b.x},${b.y}`
  }
  return d
}

const distToLeg = (p: Pt, a: Pt, b: Pt): number => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Where a new bend at `p` goes in the bend list: after the legs that come before the leg `p` is nearest to. */
export function bendIndex(start: Pt, bends: Pt[], end: Pt, p: Pt): number {
  const pts = [start, ...bends, end]
  let best = 0
  let min = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToLeg(p, pts[i]!, pts[i + 1]!)
    if (d < min) { min = d; best = i }
  }
  return best
}

/** The bends stored on a wire (`extra.bends`, layout only), ignoring anything that is not a point. */
export function readBends(extra: unknown): Pt[] {
  const list = (extra as { bends?: unknown } | undefined)?.bends
  return Array.isArray(list) ? list.filter((p): p is Pt => typeof p?.x === 'number' && typeof p?.y === 'number') : []
}
