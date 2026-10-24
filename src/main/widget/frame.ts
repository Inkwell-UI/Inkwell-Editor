import type { Node, Swf } from '@inkwell-ui/spec'
import type { WidgetAnchor } from '../../shared/overlay'

/** Design space (IR, 1920x1080) -> SkyUI HUD space (1280x720). k = 2/3 on both axes: 16:9 in, 16:9 out, so no distortion. */
export const HUD_SCALE = 2 / 3

type FrameNode = Extract<Node, { type: 'frame' }>

/** The widget is the first frame child of the root frame (its position and anchor place the widget); a root with no frame child is the widget itself. */
export function widgetFrame(ir: Swf): { frame: FrameNode; isRoot: boolean } | undefined {
  const root = ir.nodes[ir.root]
  if (root?.type !== 'frame') return undefined
  for (const cid of root.children) {
    const n = ir.nodes[cid]
    if (n?.type === 'frame') return { frame: n, isRoot: false }
  }
  return { frame: root, isRoot: true }
}

export interface WidgetPlacement {
  hAnchor: 'left' | 'center' | 'right'
  vAnchor: 'top' | 'center' | 'bottom'
  /** SkyUI HUD coordinates (1280x720) of the anchor point. */
  x: number
  y: number
  /** Percent, 0..100. */
  alpha: number
}

/** SkyUI's HUD space. */
export const HUD_WIDTH = 1280
export const HUD_HEIGHT = 720

/**
 * Anchor point of the widget frame in HUD space; anchors beyond left/center/right and top/center/bottom fall back to left/top.
 * With an overlay `anchor` override the Figma position is ignored: the point is the anchored screen edge moved inward by the margin (design px).
 */
export function widgetPlacement(ir: Swf, override?: WidgetAnchor): WidgetPlacement | undefined {
  const w = widgetFrame(ir)
  if (!w) return undefined
  const { frame, isRoot } = w
  const t = frame.transform
  const r = (n: number): number => Math.round(n * 1000) / 1000
  if (override) {
    const mx = override.x * HUD_SCALE
    const my = override.y * HUD_SCALE
    const x = override.h === 'right' ? HUD_WIDTH - mx : override.h === 'center' ? HUD_WIDTH / 2 + mx : mx
    const y = override.v === 'bottom' ? HUD_HEIGHT - my : override.v === 'center' ? HUD_HEIGHT / 2 + my : my
    return { hAnchor: override.h, vAnchor: override.v, x: r(x), y: r(y), alpha: r(frame.opacity * 100) }
  }
  const h = frame.anchor.h === 'right' || frame.anchor.h === 'center' ? frame.anchor.h : 'left'
  const v = frame.anchor.v === 'bottom' || frame.anchor.v === 'center' ? frame.anchor.v : 'top'
  const x = isRoot ? 0 : t.x
  const y = isRoot ? 0 : t.y
  const ax = h === 'right' ? x + t.width : h === 'center' ? x + t.width / 2 : x
  const ay = v === 'bottom' ? y + t.height : v === 'center' ? y + t.height / 2 : y
  return { hAnchor: h, vAnchor: v, x: r(ax * HUD_SCALE), y: r(ay * HUD_SCALE), alpha: r(frame.opacity * 100) }
}
