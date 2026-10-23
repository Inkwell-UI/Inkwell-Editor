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
  if (words.length && KNOWN_ALIASES.has(alias)) return alias
  // the fonts extracted from the game are named Everywhere/Light and <Face>/Regular: Light is $EverywhereFont, Regular is the face's only style
  if (words.length > 1 && /^(light|regular)$/i.test(words.at(-1)!)) {
    const base = '$' + words.slice(0, -1).join('') + 'Font'
    if (KNOWN_ALIASES.has(base)) return base
  }
  return undefined
}

const BOLD = /bold|black|heavy/i
const MEDIUM = /medium|semibold|demibold/i
/**
 * Nearest alias for common Figma fonts (lint warns `font-fallback`): monospace -> $ConsoleFont, script/handwriting -> $HandwrittenFont,
 * common sans families -> $EverywhereFont (bold -> Bold, medium/semibold -> Medium). Undefined when the family is unknown.
 * shortcut: name-based guess, no font metrics; extend the lists when authors hit new families.
 */
export function fallbackAlias(figmaName: string): string | undefined {
  const i = figmaName.lastIndexOf('/')
  const family = (i < 0 ? figmaName : figmaName.slice(0, i)).toLowerCase().replace(/[\s_-]+/g, '')
  const style = i < 0 ? '' : figmaName.slice(i + 1)
  if (/mono|courier|consol|menlo|monaco|firacode|codepro/.test(family)) return '$ConsoleFont'
  if (/script|hand|brush|cursive|caveat|pacifico|kalam|calligra/.test(family)) return '$HandwrittenFont'
  if (/^(inter|roboto|arial|helvetica|opensans|lato|montserrat|segoe|sfpro|sanfrancisco|calibri|verdana|tahoma|notosans|poppins|sourcesans)/.test(family))
    return MEDIUM.test(style) ? '$EverywhereMediumFont' : BOLD.test(style) ? '$EverywhereBoldFont' : '$EverywhereFont'
  return undefined
}

/** Preview-only font shim: Ruffle cannot load gfxfontlib.swf, so aliases map to its built-in device fonts (sizes, colours and layout stay). */
export const previewDeviceFont = (alias: string): string =>
  alias === '$ConsoleFont' ? '_typewriter' : /Handwritten|Dragon|Falmer|Dwemer|Daedric|MageScript/.test(alias) ? '_serif' : '_sans'

/** TextField flags a Figma sizing mode compiles to (`hasBreaks`: autoWidth content with explicit line breaks stays multiline). Used by the compiler and the Inspector. */
export function sizingFlags(sizing: TextNode['sizing'], hasBreaks = false): { wordWrap: boolean; multiline: boolean; autoSize: boolean } {
  return { wordWrap: sizing !== 'autoWidth', multiline: sizing !== 'autoWidth' || hasBreaks, autoSize: sizing !== 'fixed' }
}

/** Letter spacing in px (percent is of the font size). */
export const letterSpacingPx = (ls: TextNode['letterSpacing'], size: number): number => (ls.unit === 'px' ? ls.value : (size * ls.value) / 100)

/** What the Inspector's GFx MAPPING card shows for a text node: Figma value -> the TextField setting it compiles to. Pure; UI copy is the caller's. */
export interface TextMappingFacts {
  sizing: { value: TextNode['sizing']; flags: ReturnType<typeof sizingFlags> }
  /** GFx extension (needs `_global.gfxExtensions = true`); undefined for top. */
  verticalAlign?: 'center' | 'bottom'
  /** GFx `textAutoSize`; undefined for none. */
  textAutoSize?: 'shrink' | 'fit'
  letterSpacingPx?: number
  truncate: boolean
}
export function describeTextMapping(node: TextNode): TextMappingFacts {
  const size = node.runs[0]?.size ?? 0
  const sp = letterSpacingPx(node.letterSpacing, size)
  return {
    sizing: { value: node.sizing, flags: sizingFlags(node.sizing, node.content.includes('\n')) },
    ...(node.verticalAlign !== 'top' ? { verticalAlign: node.verticalAlign } : {}),
    ...(node.textFit !== 'none' ? { textAutoSize: node.textFit } : {}),
    ...(sp ? { letterSpacingPx: sp } : {}),
    truncate: node.truncate
  }
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

/** How a text node's font was resolved (shown in the editor window; not a lint issue). */
export interface FontInfo {
  /** Figma `family/style`. */
  figmaFont: string
  styleName?: string
  alias?: string
  via: 'text style' | 'family/style' | 'fallback' | 'unmapped'
}

export function mapText(node: TextNode): { text?: MappedText; lint: LintIssue[]; font?: FontInfo } {
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
  // Order: (a) text style name, (b) family/style, (c) fallback table + warning, (d) error. The Figma data stays in the message.
  const { name, styleName } = run.font
  const figma = `Font "${name}"${styleName ? ` (text style "${styleName}")` : ''}`
  const info = { figmaFont: name, ...(styleName ? { styleName } : {}) }
  const byStyle = styleName ? fontAlias(styleName) : undefined
  let alias = byStyle ?? fontAlias(name)
  let font: FontInfo = { ...info, ...(alias ? { alias } : {}), via: byStyle ? 'text style' : 'family/style' }
  if (!alias) {
    alias = fallbackAlias(name)
    if (!alias) {
      font = { ...info, via: 'unmapped' }
      lint.push(issue('error', 'font-unmapped', node.id, `${figma} does not map to a Skyrim font alias (expected e.g. "Everywhere / Medium / 18").`))
      return { lint, font }
    }
    font = { ...info, alias, via: 'fallback' }
    lint.push(issue('warning', 'font-fallback', node.id, `${figma} is not a Skyrim font alias; using the nearest, ${alias}. Name a Figma text style like "Everywhere / Medium / 18" to choose.`))
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
  const spacingPx = letterSpacingPx(ls, run.size)
  if (spacingPx) script.letterSpacing = spacingPx
  const lineHeightPx = lh.unit === 'auto' ? undefined : lh.unit === 'px' ? lh.value : (run.size * lh.value) / 100
  return {
    lint,
    font,
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
        ...sizingFlags(sizing, node.content.includes('\n')),
        align: ALIGN[node.align],
        leadingPx: lineHeightPx === undefined ? 0 : lineHeightPx - run.size * NATURAL_LINE_HEIGHT
      }
    }
  }
}
