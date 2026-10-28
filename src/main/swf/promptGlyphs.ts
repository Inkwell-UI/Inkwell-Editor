import type { Node, PromptDevice, Swf } from '@inkwell-ui/spec'
import { issue, type LintIssue } from './lint'

// The Prompt component (SPEC-CHANGES W4): Inkwell's own vector glyph set, added at compile time as three child frames of a role-`prompt` frame
// (`glyph_keyboard`, `glyph_xbox`, `glyph_playstation`, at the frame's top left, one frame-height tall); the menu class shows the one of the active device.
// Simple original shapes (circles, pills, key caps, symbols); no console maker's art. The IR in the project is never changed: this works on the build's copy.

export const PROMPT_DEVICE_ORDER: readonly PromptDevice[] = ['keyboard', 'xbox', 'playstation']
/** Synthetic node id of a prompt's glyph frame; lint on it and its children is reported on the prompt. */
export const glyphId = (promptId: string, d: PromptDevice): string => `${promptId}#${d}`
export const isGlyphNode = (id: string): boolean => id.includes('#')
export const glyphOwner = (id: string): string => id.slice(0, id.indexOf('#'))

type Rgb = { r: number; g: number; b: number }
const hex = (h: number): Rgb => ({ r: ((h >> 16) & 255) / 255, g: ((h >> 8) & 255) / 255, b: (h & 255) / 255 })
const DARK = 0x1c1c1c
/**
 * The game's own button art: its font `ControllerButtons` (exported by the user's fonts_en.swf, alias `ControllerButtons`; nothing of it is shipped, the SWF only names the alias like any
 * text) holds white pad glyphs on letters (and `ControllerButtonsInverted` the same as outlines). Spec glyph -> [character, advance in em], read from the extracted font (xbox A B X Y = A B C D, LB G, RB L, LT I, RT N, Start O, Back E;
 * playstation Cross a, Triangle b, Square c, Circle d, L1 g, R1 m, L2 j, R2 o, Options p). D-pad and Share stay vector. Unverified in game: INKWELL_VECTOR_GLYPHS=1 builds the vector set instead.
 */
const GAME_GLYPHS: Record<'xbox' | 'playstation', Record<string, [string, number]>> = {
  xbox: { A: ['A', 1.094], B: ['B', 1.098], X: ['C', 1.099], Y: ['D', 1.102], LB: ['G', 1.396], RB: ['L', 1.415], LT: ['I', 1.414], RT: ['N', 1.418], Start: ['O', 1.102], Back: ['E', 1.106] },
  playstation: { Cross: ['a', 1.1], Triangle: ['b', 1.099], Square: ['c', 1.103], Circle: ['d', 1.102], L1: ['g', 1.47], R1: ['m', 1.47], L2: ['j', 1.417], R2: ['o', 1.464], Options: ['p', 2.889] }
}
const gameGlyphs = (): boolean => process.env['INKWELL_VECTOR_GLYPHS'] !== '1'

const FACE: Record<string, number> = { A: 0x6bbf3a, B: 0xe0443a, X: 0x3a7be0, Y: 0xe8c22c }

/** Text width estimate of a glyph label: wide enough for "Enter"/"Options" at the glyph's font size. */
const labelWidth = (text: string, s: number): number => Math.max(s, Math.round(text.length * s * 0.38 + s * 0.5))

export function withPromptGlyphs(ir: Swf, prompts: Record<string, Partial<Record<PromptDevice, string>>>): { ir: Swf; lint: LintIssue[] } {
  const lint: LintIssue[] = []
  const nodes: Record<string, Node> = { ...ir.nodes }
  for (const [pid, glyphs] of Object.entries(prompts)) {
    const p = nodes[pid]
    if (!p) continue
    if (p.type !== 'frame') {
      lint.push(issue('error', 'prompt-not-frame', pid, 'A prompt must be a frame (its glyph is drawn inside it, at the top left).'))
      continue
    }
    const label = firstText(nodes, pid)
    if (!label) {
      lint.push(issue('error', 'prompt-no-label', pid, 'A prompt needs a text layer inside it (the label, e.g. "Select"); its font is used for the glyph letters too.'))
      continue
    }
    const s = Math.max(8, p.transform.height)
    const font = label.runs[0]!.font
    const added: string[] = []
    for (const d of PROMPT_DEVICE_ORDER) {
      const g = glyphs[d]
      if (!g) continue
      const id = glyphId(pid, d)
      const parts = glyphParts(d, g, s)
      const kids = parts.items.map((it, k) => {
        const cid = `${id}/${k}`
        nodes[cid] = it.text !== undefined ? textNode(cid, id, it, font) : shapeNode(cid, id, it)
        return cid
      })
      nodes[id] = { ...base(id, `glyph_${d}`, pid, { x: 0, y: 0, width: parts.w, height: s }), type: 'frame', clipContent: false, children: kids } as Node // all compiled visible (a hidden layer is not compiled); the menu class shows one
      added.push(id)
    }
    nodes[pid] = { ...p, children: [...p.children, ...added] }
  }
  return { ir: { ...ir, nodes }, lint }
}

function firstText(nodes: Record<string, Node>, id: string): Extract<Node, { type: 'text' }> | undefined {
  for (const c of nodes[id]?.children ?? []) {
    const n = nodes[c]
    if (n?.type === 'text') return n
    const t = n ? firstText(nodes, c) : undefined
    if (t) return t
  }
  return undefined
}

interface Item { x: number; y: number; w: number; h: number; color: number; poly?: [number, number][]; stroke?: number; text?: string; size?: number; font?: string }

/** The parts of one glyph in a box `s` tall (local coordinates), and its width. */
export function glyphParts(d: PromptDevice, g: string, s: number): { w: number; items: Item[] } {
  const box = (w: number, h: number, x = 0, y = 0): Item => ({ x, y, w, h, color: DARK })
  const disc = (color: number): Item => ({ ...box(s, s), color, poly: circle(s / 2, s / 2, s / 2) })
  const letter = (text: string, color: number, w = s): Item => {
    const size = Math.round(s * (text.length > 1 ? 0.42 : 0.55))
    return { x: 0, y: Math.round((s - size * 1.25) / 2), w, h: Math.round(size * 1.25), color, text, size }
  }
  const game = d !== 'keyboard' && gameGlyphs() ? GAME_GLYPHS[d][g] : undefined
  if (game) {
    // the look of the game's own prompts: a dark disc (round buttons) or pill (shoulders, triggers, Options) of ours behind the game's outline font `ControllerButtonsInverted` (grey ring and letter,
    // transparent inside). The glyphs are about 1.04 em tall (-0.205..0.838 em around the baseline); the SWF font's ascent is 0.99 em, so the glyph top sits 0.155 em below the line top.
    const size = Math.round(s * 0.96)
    const w = Math.round(game[1] * size)
    const round = game[1] < 1.2
    const backing: Item = { ...box(w, s), color: 0x1c1c1c, poly: round ? circle(w / 2, s / 2, Math.min(w, s) / 2) : chamfer(0, 0, w, s, s * 0.3) }
    return { w, items: [backing, { x: 0, y: -Math.round(0.155 * size), w, h: Math.round(size * 1.24), color: 0xc8c8c8, text: game[0], size, font: 'ControllerButtonsInverted' }] }
  }
  if (g.startsWith('Dpad')) {
    const a = s * 0.32
    const arm = (k: 'Up' | 'Down' | 'Left' | 'Right'): [number, number][] => {
      const c = (s - a) / 2
      return k === 'Up' ? rect(c, 0, a, c + 1) : k === 'Down' ? rect(c, s - c - 1, a, c + 1) : k === 'Left' ? rect(0, c, c + 1, a) : rect(s - c - 1, c, c + 1, a)
    }
    const on = g.slice(4) as 'Up'
    return { w: s, items: [{ ...box(s, s), color: 0x8a8a8a, poly: rect((s - a) / 2, (s - a) / 2, a, a) }, ...(['Up', 'Down', 'Left', 'Right'] as const).map((k) => ({ ...box(s, s), color: k === on ? 0xffffff : 0x8a8a8a, poly: arm(k) }))] }
  }
  if (d === 'keyboard') {
    const w = labelWidth(g, s)
    return { w, items: [{ ...box(w, s), color: 0x8a8a8a, poly: chamfer(0, 0, w, s, s * 0.18) }, { ...box(w, s), color: 0xe6e6e6, poly: chamfer(0, 0, w, s * 0.88, s * 0.18) }, { ...letter(g, 0x202020, w), y: Math.round((s * 0.88 - Math.round(s * (g.length > 1 ? 0.42 : 0.55)) * 1.25) / 2) }] }
  }
  if (d === 'xbox' && FACE[g] !== undefined) return { w: s, items: [disc(DARK), letter(g, FACE[g]!)] }
  if (d === 'playstation' && ['Cross', 'Circle', 'Square', 'Triangle'].includes(g)) {
    const c = s / 2
    const r = s * 0.22
    const t = Math.max(2, s * 0.08)
    const sym: Item =
      g === 'Cross' ? { ...box(s, s), color: 0x7fa8e0, poly: [...bar(c - r, c - r, c + r, c + r, t)] }
        : g === 'Circle' ? { ...box(s, s), color: 0xe06a6a, poly: circle(c, c, r), stroke: t }
          : g === 'Square' ? { ...box(s, s), color: 0xd88ad8, poly: rect(c - r, c - r, 2 * r, 2 * r), stroke: t }
            : { ...box(s, s), color: 0x5cc8a8, poly: [[c, c - r * 1.1], [c + r * 1.1, c + r * 0.75], [c - r * 1.1, c + r * 0.75]], stroke: t }
    const items = [disc(DARK), sym]
    if (g === 'Cross') items.push({ ...box(s, s), color: 0x7fa8e0, poly: bar(c + r, c - r, c - r, c + r, t) })
    return { w: s, items }
  }
  // bumpers, triggers, Start/Back/Options/Share: a dark pill with the name
  const w = labelWidth(g, s)
  return { w, items: [{ ...box(w, s), poly: chamfer(0, 0, w, s, s * 0.3) }, letter(g, 0xffffff, w)] }
}

const rect = (x: number, y: number, w: number, h: number): [number, number][] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
const chamfer = (x: number, y: number, w: number, h: number, r: number): [number, number][] => [[x + r, y], [x + w - r, y], [x + w, y + r], [x + w, y + h - r], [x + w - r, y + h], [x + r, y + h], [x, y + h - r], [x, y + r]]
// shortcut: circles are 24-gons (no cubics, so no `curve-approximated` lint); use curves if the edge shows at large sizes
const circle = (cx: number, cy: number, r: number): [number, number][] => Array.from({ length: 24 }, (_, k) => [cx + r * Math.cos((k * Math.PI) / 12), cy + r * Math.sin((k * Math.PI) / 12)] as [number, number])
/** A thick line from (x1,y1) to (x2,y2) as a quad. */
const bar = (x1: number, y1: number, x2: number, y2: number, t: number): [number, number][] => {
  const l = Math.hypot(x2 - x1, y2 - y1) || 1
  const nx = (-(y2 - y1) / l) * (t / 2)
  const ny = ((x2 - x1) / l) * (t / 2)
  return [[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]]
}

const base = (id: string, name: string, parent: string, t: { x: number; y: number; width: number; height: number }) => ({
  id, name, parent, children: [] as string[], transform: { ...t, rotation: 0 }, anchor: { h: 'left' as const, v: 'top' as const }, visible: true, opacity: 1
})
const r2 = (n: number): number => Math.round(n * 100) / 100

function shapeNode(id: string, parent: string, it: Item): Node {
  const pts = it.poly ?? rect(0, 0, it.w, it.h)
  const path = [{ op: 'M' as const, x: r2(pts[0]![0]), y: r2(pts[0]![1]) }, ...pts.slice(1).map(([x, y]) => ({ op: 'L' as const, x: r2(x), y: r2(y) })), { op: 'Z' as const }]
  const paint = { type: 'solid' as const, color: hex(it.color) }
  return { ...base(id, 'part', parent, { x: it.x, y: it.y, width: it.w, height: it.h }), type: 'shape', paths: [path], fills: it.stroke ? [] : [paint], strokes: it.stroke ? [{ fill: paint, weight: it.stroke, alignment: 'center' as const }] : [] } as Node
}

function textNode(id: string, parent: string, it: Item, labelFont: Extract<Node, { type: 'text' }>['runs'][number]['font']): Node {
  const text = it.text!
  const font = it.font ? ({ kind: 'alias', name: it.font } as typeof labelFont) : labelFont
  return {
    ...base(id, 'key', parent, { x: it.x, y: it.y, width: it.w, height: it.h }), type: 'text', content: text,
    runs: [{ start: 0, end: text.length, font, size: it.size!, fill: { type: 'solid', color: hex(it.color) } }],
    sizing: 'fixed', align: 'center', verticalAlign: 'top', lineHeight: { unit: 'auto' }, letterSpacing: { unit: 'px', value: 0 }, textFit: 'none', truncate: false
  } as Node
}
