import { boundValue, isThemeBindingKey, themedCollection, type Swf } from '@inkwell-ui/spec'
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

/** The runtime-themable bindings of a custom menu's IR with their value in every mode of the themed collection. Empty without a themed collection. */
export function themeOps(ir: Swf): ThemeOp[] {
  const col = themedCollection(ir.themes)
  if (!col) return []
  const out: ThemeOp[] = []
  for (const n of Object.values(ir.nodes)) {
    for (const [key, ref] of Object.entries(n.bindings ?? {})) {
      if (!isThemeBindingKey(key) || bindingMode(key, n) !== 'runtime') continue
      const kind: ThemeKind | undefined = KINDS.find(([k]) => k === key)?.[1] ?? (/^fills\/0\/color$/.test(key) ? 'c' : undefined)
      if (!kind) continue
      const values: ThemeOp['values'] = {}
      for (const m of col.modes) {
        const v = boundValue(col, key, ref.id, m)
        if (v === undefined) continue
        values[m] = kind === 'c' || kind === 't' ? rgb(v as { r: number; g: number; b: number }) : kind === 'a' ? Math.min(100, Math.max(0, Math.round(v as number))) : (v as number | boolean)
      }
      if (Object.keys(values).length) out.push({ nodeId: n.id, target: kind === 'c' && n.type === 'frame' ? 'fill' : 'self', kind, values })
    }
  }
  return out
}
