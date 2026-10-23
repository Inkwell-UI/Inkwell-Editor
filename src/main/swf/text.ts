import type { Node } from '@inkwell-ui/spec'
import { issue, type LintIssue } from './lint'
import type { EditTextSpec } from './tags'

type TextNode = Extract<Node, { type: 'text' }>

/** Flash puts a 2 px gutter inside every TextField; the field is grown by it and moved back so the glyphs land where Figma drew them. */
export const GUTTER = 2
/** Provisional: natural line height / font size of Skyrim's fonts, used by the leading formula. Unmeasured in game. */
export const NATURAL_LINE_HEIGHT = 1.2

/** Aliases that exist in vanilla's fontconfig.txt (names only; nothing from the file is shipped). */
export const KNOWN_ALIASES: ReadonlySet<string> = new Set([
  '$ConsoleFont', '$StartMenuFont', '$DialogueFont', '$EverywhereFont', '$EverywhereBoldFont', '$EverywhereMediumFont', '$DragonFont',
  '$HandwrittenFont', '$FalmerFont', '$DwemerFont', '$DaedricFont', '$MageScriptFont', '$SkyrimSymbolsFont'
])

/**
 * `Everywhere / Medium / 18` -> `$EverywhereMediumFont` (a trailing numeric segment is the size preset and is dropped).
 * A raw `$EverywhereMediumFont` is accepted. Anything not in KNOWN_ALIASES is unmapped.
 */
export function fontAlias(name: string): string | undefined {
  const t = name.trim()
  if (t.startsWith('$')) return KNOWN_ALIASES.has(t) ? t : undefined
  const words = t.split('/').map((s) => s.trim().replace(/\s+/g, '')).filter(Boolean)
  if (words.length && /^\d+(\.\d+)?$/.test(words.at(-1)!)) words.pop()
  const alias = '$' + words.join('') + 'Font'
  return words.length && KNOWN_ALIASES.has(alias) ? alias : undefined
}

const ALIGN = { left: 0, right: 1, center: 2, justify: 3 } as const

export interface TextScript {
  verticalAlign?: 'center' | 'bottom'
  textAutoSize?: 'shrink' | 'fit'
  /** px */
  letterSpacing?: number
}

export interface MappedText {
  alias: string
  field: Omit<EditTextSpec, 'id' | 'fontId'>
  /** Offset to add to the node position (gutter compensation, before rotation). */
  gutter: { x: number; y: number }
  script: TextScript
}

export function mapText(node: TextNode): { text?: MappedText; lint: LintIssue[] } {
  const lint: LintIssue[] = []
  const run = node.runs[0]
  if (!run) {
    lint.push(issue('error', 'text-no-run', node.id, 'Text node has no style run.'))
    return { lint }
  }
  if (node.runs.length > 1) lint.push(issue('warning', 'text-mixed-styles', node.id, 'Mixed text styles are not supported in 0.1; the first run styles the whole text.'))
  if (run.font.kind !== 'alias') {
    lint.push(issue('error', 'font-unmapped', node.id, 'Embedded fonts are not supported yet.'))
    return { lint }
  }
  const alias = fontAlias(run.font.name)
  if (!alias) {
    lint.push(issue('error', 'font-unmapped', node.id, `Font "${run.font.name}" does not map to a Skyrim font alias (expected e.g. "Everywhere / Medium / 18").`))
    return { lint }
  }
  if (node.truncate) lint.push(issue('warning', 'text-truncate-unsupported', node.id, 'Truncation needs the runtime helper, which is not generated yet.'))

  const f = run.fill
  let color = { r: 0, g: 0, b: 0, a: 255 }
  if (f?.type === 'solid') {
    const c = f.color
    const b = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255)
    color = { r: b(c.r), g: b(c.g), b: b(c.b), a: b((c.a ?? 1) * (f.opacity ?? 1)) }
  } else if (f) {
    lint.push(issue('warning', 'text-fill-unsupported', node.id, `${f.type} text fills are not supported; drawn black.`))
  }

  const { sizing } = node
  const { width, height } = node.transform
  const script: TextScript = {}
  if (node.verticalAlign !== 'top') script.verticalAlign = node.verticalAlign
  if (node.textFit !== 'none') script.textAutoSize = node.textFit
  const { lineHeight: lh, letterSpacing: ls } = node
  const spacingPx = ls.unit === 'px' ? ls.value : (run.size * ls.value) / 100
  if (spacingPx) script.letterSpacing = spacingPx
  const lineHeightPx = lh.unit === 'auto' ? undefined : lh.unit === 'px' ? lh.value : (run.size * lh.value) / 100
  return {
    lint,
    text: {
      alias,
      gutter: { x: -GUTTER, y: -GUTTER },
      script,
      field: {
        wPx: width + 2 * GUTTER,
        hPx: height + 2 * GUTTER,
        sizePx: run.size,
        color,
        text: node.content.replace(/\r?\n/g, '\r'),
        // autoWidth: one line unless the content has breaks; autoHeight/fixed wrap at the box width
        wordWrap: sizing !== 'autoWidth',
        multiline: sizing !== 'autoWidth' || node.content.includes('\n'),
        autoSize: sizing !== 'fixed',
        align: ALIGN[node.align],
        leadingPx: lineHeightPx === undefined ? 0 : lineHeightPx - run.size * NATURAL_LINE_HEIGHT
      }
    }
  }
}
