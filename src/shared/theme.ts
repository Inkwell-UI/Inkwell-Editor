import type { Node, Swf, Theme } from '@inkwell-ui/spec'
import { themedCollection } from '@inkwell-ui/spec'

// Which theme bindings the INI can change in game (SPEC-CHANGES V6.4) and which only the compile-time default sets. One rule for the lint, the Inspector chips and the codegen.

export type BindingMode = 'runtime' | 'compile'

/**
 * Runtime: opacity and visibility, the size of a shape or text (a frame resized at runtime would stretch its children), the colour of a text run, and the colour of a shape
 * or of the background of a non-root frame when it is exactly one solid fill and, for a shape, no stroke (a tint recolours the whole clip). Compile time only: gradients,
 * images, strokes, frame size, text size.
 */
export function bindingMode(key: string, node: Node): BindingMode {
  if (key === 'opacity' || key === 'visible') return 'runtime'
  if (key === 'transform/width' || key === 'transform/height') return node.type === 'shape' || node.type === 'text' ? 'runtime' : 'compile'
  if (key === 'runs/0/fill/color') return node.type === 'text' && node.runs[0]?.fill?.type === 'solid' ? 'runtime' : 'compile'
  const m = /^fills\/(\d+)\/color$/.exec(key)
  if (m && (node.type === 'shape' || node.type === 'frame')) {
    const fills = node.fills ?? []
    const strokes = node.type === 'shape' ? node.strokes : []
    return fills.length === 1 && fills[0]?.type === 'solid' && strokes.length === 0 && m[1] === '0' && !(node.type === 'frame' && node.parent === null) ? 'runtime' : 'compile'
  }
  return 'compile'
}

/** The themed collection of a SWF and the variable a binding points to. */
export function themeVariable(ir: Pick<Swf, 'themes'>, id: string): { collection: Theme; name: string } | undefined {
  const collection = themedCollection(ir.themes)
  const v = collection?.variables?.[id]
  return collection && v ? { collection, name: v.name } : undefined
}
