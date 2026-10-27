// W3/W4 without FFDec: the focus graph and prompts of samples/menu-gamepad, the glyph layers, golden AS2 of the menu class, the inputContext lint.
// The FFDec compile of the sample is focus.integration.test.ts.
import { resolve } from 'node:path'
import { Swf } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { loadProject } from '../project'
import { generate } from '../swf/generate'
import { glyphParts, withPromptGlyphs } from '../swf/promptGlyphs'
import { menuClassSource } from '../codegen/menuGlue'
import { defaultMenuSettings, menuLint } from '../../shared/menu'
import { focusOptions, hasFocusGraph } from './focus'

const sample = resolve(__dirname, '../../../samples/menu-gamepad')
const load = async () => {
  const project = await loadProject(sample)
  const s = project.swfs['menu']!
  const nodes = (s.overlay as { nodes: Record<string, Record<string, unknown>> }).nodes
  return { ir: Swf.parse(s.ir), nodes, project }
}

describe('samples/menu-gamepad', () => {
  it('has a clean focus graph with the overrides that break the geometry, and two prompts', async () => {
    const { ir, nodes } = await load()
    const fo = focusOptions(ir, nodes)
    expect(fo.lint).toEqual([])
    expect(fo.focus!.order).toEqual(['2:11', '2:12', '2:13', '2:14'])
    expect(fo.focus!.moves).toEqual({
      '2:11': { up: '2:14', down: '2:13', left: '2:14', right: '2:12' },
      '2:12': { up: '2:11', down: '2:14', left: '2:11', right: '2:13' },
      '2:13': { up: '2:11', down: '2:14', left: '2:12', right: '2:14' },
      '2:14': { up: '2:12', down: '2:11', left: '2:13', right: '2:11' }
    })
    expect(fo.prompts).toEqual({ '2:7': { keyboard: 'Enter', xbox: 'A', playstation: 'Cross' }, '2:8': { keyboard: 'Esc', xbox: 'B', playstation: 'Circle' } })
    expect(hasFocusGraph(nodes)).toBe(true)
  })

  it('compiles the glyphs as clips inside the prompts and hands paths and move indices to the menu class', async () => {
    const { ir, nodes } = await load()
    const fo = focusOptions(ir, nodes)
    const roles = Object.fromEntries(Object.entries(nodes).flatMap(([id, o]) => (typeof o['role'] === 'string' ? [[id, o['role']]] : [])))
    const instanceNames = Object.fromEntries(Object.entries(nodes).flatMap(([id, o]) => (typeof o['instanceName'] === 'string' ? [[id, o['instanceName']]] : [])))
    const g = generate(ir, { modId: 'InkwellMenuGamepad', roles, instanceNames, focus: fo.focus!, prompts: fo.prompts! })
    expect(g.lint.filter((l) => l.severity === 'error')).toEqual([])
    expect(g.lint.some((l) => l.nodeId.includes('#'))).toBe(false)
    expect(g.fonts.some((f) => f.nodeId.includes('#'))).toBe(false)
    expect(g.layerPaths['2:7#xbox']).toBe('root.promptSelect.glyph_xbox')
    const cls = g.as2.find((a) => a.path.endsWith('MenuMenu.as'))!.source
    expect(cls).toContain('this.focusPaths = ["btn1", "btn2", "btn3", "btn4"];')
    expect(cls).toContain('this.focusMoves = [[3, 2, 3, 1], [0, 3, 0, 2], [0, 3, 1, 3], [1, 0, 2, 0]];')
    expect(cls).toContain('this.prompts = [["promptSelect.glyph_keyboard", "promptSelect.glyph_xbox", "promptSelect.glyph_playstation"], ["promptBack.glyph_keyboard", "promptBack.glyph_xbox", "promptBack.glyph_playstation"]];')
    // the project's IR is untouched
    expect(ir.nodes['2:7']!.children).toEqual(['2:7t'])
  })

  it('menuMode is enforced: a focus graph with Input Context None is an error', () => {
    const s = defaultMenuSettings()
    const none = { ...s, inputContext: 'none' as const }
    expect(menuLint('M', [{ swf: 'menu', settings: none, features: ['focusGraph'] }]).map((r) => r.code)).toEqual(['focus-input-context'])
    expect(menuLint('M', [{ swf: 'menu', settings: { ...s, inputContext: 'menuMode' }, features: ['focusGraph'] }])).toEqual([])
    expect(menuLint('M', [{ swf: 'menu', settings: none }])).toEqual([])
    // absent context follows `modal` (the default is modal = menuMode)
    expect(menuLint('M', [{ swf: 'menu', settings: { ...s, flags: { ...s.flags, modal: false } }, features: ['focusGraph'] }]).map((r) => r.code)).toEqual(['focus-input-context'])
  })
})

describe('prompt glyphs', () => {
  it('need a frame with a text label', async () => {
    const { ir } = await load()
    expect(withPromptGlyphs(ir, { '2:5': { xbox: 'A' } }).lint.map((l) => l.code)).toEqual(['prompt-not-frame'])
    expect(withPromptGlyphs(ir, { '2:11': { xbox: 'A' } }).lint).toEqual([]) // a button frame has a label
    const bare = { ...ir, nodes: { ...ir.nodes, '2:7': { ...ir.nodes['2:7']!, children: [] } } } as Swf
    expect(withPromptGlyphs(bare, { '2:7': { xbox: 'A' } }).lint.map((l) => l.code)).toEqual(['prompt-no-label'])
  })
  it('draw every glyph of the set in the box height; key caps and pills widen with the name', () => {
    for (const g of ['A', 'B', 'X', 'Y', 'LB', 'RT', 'Start', 'DpadUp']) expect(glyphParts('xbox', g, 48).items.length).toBeGreaterThan(1)
    for (const g of ['Cross', 'Circle', 'Square', 'Triangle', 'L2', 'Options']) expect(glyphParts('playstation', g, 48).items.length).toBeGreaterThan(1)
    expect(glyphParts('xbox', 'A', 48).w).toBe(48)
    expect(glyphParts('keyboard', 'E', 48).w).toBe(48)
    expect(glyphParts('keyboard', 'Enter', 48).w).toBeGreaterThan(48)
  })
  it('golden menu class with a focus graph and a prompt', () => {
    expect(menuClassSource({ modId: 'M', swfCls: 'Menu', graphs: [], focus: { paths: ['a', 'p.b'], moves: [[1, 1, 1, 1], [0, 0, 0, 0]] }, prompts: [['pr.glyph_keyboard', 'pr.glyph_xbox', null]] })).toMatchSnapshot()
  })
})
