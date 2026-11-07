import { isThemeBindingKey, themeModes, variableIn, type Swf } from '@inkwell-ui/spec'
import { bindingMode } from '../../shared/theme'
import type { LintIssue } from '../../shared/swfLint'

/**
 * Theme findings of one SWF (SPEC-CHANGES V6.5): `theme-default-unknown` (error, the menu's default theme is not a mode of the themed collection), `theme-variable-missing`
 * (warning, a binding names a variable the themed collection lacks: deleted in Figma, in another collection or a remote library) and `theme-binding-not-runtime` (warning, custom
 * menus only: a HUD widget has no INI, so only the compile-time default exists there). Keys the toolchain does not know are ignored.
 */
export function themeLint(ir: Swf, defaultTheme: string | undefined): LintIssue[] {
  const modes = themeModes(ir)
  const out: LintIssue[] = []
  if (!modes.length) return out
  if (defaultTheme && !modes.includes(defaultTheme))
    out.push({ severity: 'error', code: 'theme-default-unknown', nodeId: ir.root, message: `Default theme "${defaultTheme}" is not a mode of any variable collection (${modes.join(', ')}). Pick one in Menu settings.` })
  for (const n of Object.values(ir.nodes)) {
    for (const [key, ref] of Object.entries(n.bindings ?? {})) {
      if (!isThemeBindingKey(key)) continue
      if (!variableIn(ir.themes, ref.id))
        out.push({ severity: 'warning', code: 'theme-variable-missing', nodeId: n.id, nodeName: n.name, message: `"${n.name}" is bound to a variable (${key}) that is not in a local variable collection (deleted in Figma, or from a library): it keeps the value Figma sent.` })
      else if (ir.target.kind === 'customMenu' && bindingMode(key, n) === 'compile')
        out.push({ severity: 'warning', code: 'theme-binding-not-runtime', nodeId: n.id, nodeName: n.name, message: `"${n.name}" ${key} follows the theme only at compile time: the INI Theme key does not change it (gradient, image, stroke, text size or content, spacing).` })
    }
  }
  return out
}
