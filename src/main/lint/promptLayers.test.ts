import type { Swf } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { withPromptGlyphs } from '../swf/promptGlyphs'
import { focusOptions } from '../../shared/focusLint'

const t = (x: number, y: number, w: number, h: number) => ({ x, y, width: w, height: h, rotation: 0 })
const font = { kind: 'alias', name: '$EverywhereMediumFont' }
// a prompt layer with an icon placeholder (a shape in a sub-frame's sibling) and a text layer; the prompt may be an instance (Figma ids its children I<id>;<id>) or a plain frame
const ir = {
  target: { kind: 'customMenu' },
  nodes: {
    p: { id: 'p', type: 'instance', name: 'Prompt', parent: null, component: 'c', children: ['p.icon', 'p.text'], transform: t(0, 0, 100, 50) },
    'p.icon': { id: 'p.icon', type: 'shape', name: 'whatever', parent: 'p', children: [], transform: t(7, 7, 36, 36) },
    'p.text': { id: 'p.text', type: 'text', name: 'label', parent: 'p', children: [], transform: t(50, 10, 40, 20), runs: [{ start: 0, end: 1, font, size: 20 }], content: 'x' }
  }
} as unknown as Swf
const nodes = { p: { role: 'prompt', prompt: { action: 'Accept', icon: 'p.icon', label: 'p.text' } } }

describe('prompt layers', () => {
  it('uses the icon and text layer the author chose', () => {
    const fo = focusOptions(ir, nodes)
    expect(fo.lint).toEqual([])
    expect(fo.prompts).toEqual({ p: { keyboard: 'Enter', xbox: 'A', playstation: 'Cross' } })
    expect(fo.promptLayers).toEqual({ p: { icon: 'p.icon', label: 'p.text' } })
  })
  it('puts the glyph on the icon layer, keeps the placeholder in the layout without drawing it, and keeps the glyph out of the flow', () => {
    const fo = focusOptions(ir, nodes)
    const r = withPromptGlyphs(ir, fo.prompts!, fo.promptLayers)
    expect(r.lint).toEqual([])
    expect(r.ir.nodes['p#xbox']!.transform).toMatchObject({ x: 7, y: 7, height: 36 })
    // transparent, still in the flow (a hidden layer would leave the auto layout and the text would move); the glyph frame is outside the flow
    expect(r.ir.nodes['p.icon']!.opacity).toBe(0)
    expect(r.ir.nodes['p.icon']!.visible).not.toBe(false)
    expect(r.ir.nodes['p#xbox']).toMatchObject({ layout: { absolute: true } })
  })
  it('works without a text layer (the drawn key caps use the default font)', () => {
    const fo = focusOptions(ir, { p: { role: 'prompt', prompt: { action: 'Accept', icon: 'p.icon' } } })
    const noText = { ...ir, nodes: { ...ir.nodes, p: { ...ir.nodes['p'], children: ['p.icon'] } } } as unknown as Swf
    expect(withPromptGlyphs(noText, fo.prompts!, fo.promptLayers).lint).toEqual([])
  })
  it('warns when a chosen layer is gone and keeps the default', () => {
    const fo = focusOptions(ir, { p: { role: 'prompt', prompt: { action: 'Accept', icon: '9:9' } } })
    expect(fo.lint.map((l) => l.code)).toEqual(['prompt-layer-missing'])
    expect(fo.promptLayers).toBeUndefined()
  })
  it('ignores a role mark left on a component definition (no error, the definition is not in the menu)', () => {
    const withMaster = { ...ir, nodes: { ...ir.nodes, c: { id: 'c', type: 'component', name: 'p_MenuPrompt', parent: null, children: [], transform: t(0, 0, 100, 50), variants: [] } } } as unknown as Swf
    const fo = focusOptions(withMaster, { ...nodes, c: { role: 'prompt', prompt: { icon: 'x' } } })
    expect(fo.lint).toEqual([])
    expect(Object.keys(fo.prompts ?? {})).toEqual(['p'])
  })
  it('only a layer with role prompt is a prompt (no lookup through a component)', () => {
    expect(focusOptions(ir, { c: { role: 'prompt', prompt: { action: 'Accept' } }, p: { prompt: { action: 'Accept' } } }).prompts).toBeUndefined()
  })
})
