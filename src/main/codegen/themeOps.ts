import { boundIn, isThemeBindingKey, pinsOf, themeModes, type Swf } from '@inkwell-ui/spec'
import { bindingMode } from '../../shared/theme'

// The runtime part of theming (SPEC-CHANGES V6.4): what the menu class sets when the INI names a theme. Pure; the compile-time default is `applyTheme`.

/** `a` alpha (percent), `v` visible, `w` width, `h` height, `c` tint of a shape clip (0xRRGGBB), `t` text colour (0xRRGGBB). */
export type ThemeKind = 'a' | 'v' | 'w' | 'h' | 'c' | 't'

export interface ThemeOp {
  nodeId: string
  /** `fill` = the background clip `fill` of a frame; `self` = the node's own clip or text field. */
  target: 'self' | 'fill'
  kind: ThemeKind
  /** Value per theme (mode name). */
  values: Record<string, number | boolean>
}

const rgb = (c: { r: number; g: number; b: number }): number => (Math.round(c.r * 255) << 16) | (Math.round(c.g * 255) << 8) | Math.round(c.b * 255)

const KINDS: [string, ThemeKind][] = [['opacity', 'a'], ['visible', 'v'], ['transform/width', 'w'], ['transform/height', 'h'], ['runs/0/fill/color', 't']]

/**
 * The runtime-themable bindings of a custom menu's IR with their value in every theme (each variable in its own collection, a layer's pinned mode winning). Empty without a themed
 * collection. A colour variable's alpha is part of the colour: a tint also gets an `a` op (the fill clip's alpha, or a shape's opacity times it) because the clip is drawn opaque (`generate.ts`, `tint`).
 * shortcut: a text colour's alpha is not changed at run time (the text field's alpha is baked in its colour); upgrade when a text colour variable needs it.
 */
export function themeOps(ir: Swf): ThemeOp[] {
  const modes = themeModes(ir)
  if (!modes.length) return []
  const out: ThemeOp[] = []
  const tints: { node: Swf['nodes'][string]; target: ThemeOp['target']; alpha: Record<string, number> }[] = []
  for (const n of Object.values(ir.nodes)) {
    const pins = n.bindings ? pinsOf(ir.nodes, n.id) : undefined
    for (const [key, ref] of Object.entries(n.bindings ?? {})) {
      if (!isThemeBindingKey(key) || bindingMode(key, n) !== 'runtime') continue
      const kind: ThemeKind | undefined = KINDS.find(([k]) => k === key)?.[1] ?? (/^fills\/0\/color$/.test(key) ? 'c' : undefined)
      if (!kind) continue
      const values: ThemeOp['values'] = {}
      const alpha: Record<string, number> = {}
      for (const m of modes) {
        const v = boundIn(ir.themes, key, ref.id, m, pins)
        if (v === undefined) continue
        values[m] = kind === 'c' || kind === 't' ? rgb(v as { r: number; g: number; b: number }) : kind === 'a' ? Math.min(100, Math.max(0, Math.round(v as number))) : (v as number | boolean)
        if (kind === 'c') alpha[m] = (v as { a?: number }).a ?? 1
      }
      if (!Object.keys(values).length) continue
      const target = kind === 'c' && n.type === 'frame' ? 'fill' : 'self'
      out.push({ nodeId: n.id, target, kind, values })
      if (kind === 'c') tints.push({ node: n, target, alpha })
    }
  }
  for (const t of tints) {
    const prev = t.target === 'self' ? out.find((o) => o.nodeId === t.node.id && o.target === 'self' && o.kind === 'a') : undefined
    const values: ThemeOp['values'] = {}
    for (const [m, a] of Object.entries(t.alpha)) {
      const own = prev?.values[m]
      values[m] = Math.min(100, Math.max(0, Math.round(100 * a * (typeof own === 'number' ? own / 100 : t.target === 'self' ? t.node.opacity : 1))))
    }
    if (prev) Object.assign(prev.values, values)
    else out.push({ nodeId: t.node.id, target: t.target, kind: 'a', values })
  }
  return out
}
