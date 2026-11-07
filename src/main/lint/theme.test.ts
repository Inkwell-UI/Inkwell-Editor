import { describe, expect, it } from 'vitest'
import { Swf, type Theme } from '@inkwell-ui/spec'
import { bindingMode } from '../../shared/theme'
import { themeLint } from './theme'

const col: Theme = { name: 'Colors', modes: ['Vanilla', 'Nordic'], variables: { A: { name: 'accent', type: 'color', values: { Vanilla: { r: 1, g: 1, b: 1 }, Nordic: { r: 0, g: 0, b: 1 } } }, S: { name: 'size', type: 'number', values: { Vanilla: 20, Nordic: 30 } } } }
const t = { x: 0, y: 0, width: 10, height: 10, rotation: 0 }
const b = { transform: t, anchor: { h: 'left', v: 'top' }, visible: true, opacity: 1, children: [] as string[] }
const red = { type: 'solid', color: { r: 1, g: 0, b: 0 } }
const ir = (kind: string) => Swf.parse({
  specVersion: 7, id: 's', name: 's', target: { kind }, stage: { width: 1, height: 1 }, root: 'f', themes: [col],
  nodes: {
    f: { ...b, id: 'f', name: 'f', parent: null, type: 'frame', clipContent: false, children: ['one', 'two', 'gone', 'txt'] },
    one: { ...b, id: 'one', name: 'one', parent: 'f', type: 'shape', paths: [], fills: [red], strokes: [], bindings: { 'fills/0/color': { id: 'A' }, opacity: { id: 'A' } } },
    two: { ...b, id: 'two', name: 'two', parent: 'f', type: 'shape', paths: [], fills: [red], strokes: [{ fill: red, weight: 1, alignment: 'center' }], bindings: { 'fills/0/color': { id: 'A' }, 'strokes/0/color': { id: 'A' } } },
    gone: { ...b, id: 'gone', name: 'gone', parent: 'f', type: 'frame', clipContent: false, bindings: { opacity: { id: 'DELETED' }, 'extra/key': { id: 'A' } } },
    txt: { ...b, id: 'txt', name: 'txt', parent: 'f', type: 'text', content: 'x', sizing: 'fixed', align: 'left', verticalAlign: 'top', lineHeight: { unit: 'auto' }, letterSpacing: { unit: 'px', value: 0 }, textFit: 'none', truncate: false,
      runs: [{ start: 0, end: 1, font: { kind: 'alias', name: 'a' }, size: 12, fill: red }], bindings: { 'runs/0/fill/color': { id: 'A' }, 'runs/0/size': { id: 'S' } } }
  }
})

describe('bindingMode', () => {
  const n = ir('customMenu').nodes
  it('is runtime for opacity, a single solid fill and a text colour; compile time for strokes, a fill next to a stroke and text size', () => {
    expect(bindingMode('opacity', n['one']!)).toBe('runtime')
    expect(bindingMode('fills/0/color', n['one']!)).toBe('runtime')
    expect(bindingMode('fills/0/color', n['two']!)).toBe('compile')
    expect(bindingMode('strokes/0/color', n['two']!)).toBe('compile')
    expect(bindingMode('runs/0/fill/color', n['txt']!)).toBe('runtime')
    expect(bindingMode('runs/0/size', n['txt']!)).toBe('compile')
  })
})

describe('gradient stop bindings', () => {
  it('are known keys, compile time only, and checked against the collection', () => {
    const g = { type: 'linear', stops: [{ position: 0, color: { r: 1, g: 1, b: 1 } }, { position: 1, color: { r: 0, g: 0, b: 0 } }] }
    const base = ir('customMenu')
    const one = { ...base.nodes['one']!, fills: [g], bindings: { 'fills/0/stops/0/color': { id: 'A' }, 'fills/0/stops/1/color': { id: 'DELETED' } } } as typeof base.nodes[string]
    const l = themeLint({ ...base, nodes: { f: base.nodes['f']!, one } }, undefined)
    expect(l.map((x) => `${x.code}:${x.nodeId}`).sort()).toEqual(['theme-binding-not-runtime:one', 'theme-variable-missing:one'])
    expect(bindingMode('fills/0/stops/0/color', one)).toBe('compile')
  })
})

describe('several collections', () => {
  it('a variable of any local collection is found, and a mode of any multi-mode collection is a valid default theme', () => {
    const base = ir('customMenu')
    const dens: Theme = { name: 'Density', modes: ['Compact', 'Roomy'], variables: { G: { name: 'gap', type: 'number', values: { Compact: 4, Roomy: 12 } } } }
    const one = { ...base.nodes['one']!, bindings: { opacity: { id: 'G' } } } as typeof base.nodes[string]
    const l = themeLint({ ...base, themes: [col, dens], nodes: { f: base.nodes['f']!, one } }, 'Roomy')
    expect(l.map((x) => x.code)).toEqual([])
    expect(themeLint({ ...base, themes: [col, dens], nodes: { f: base.nodes['f']!, one } }, 'Nope').map((x) => x.code)).toEqual(['theme-default-unknown'])
  })
})

describe('themeLint', () => {
  it('flags a missing variable and compile-time-only bindings of a custom menu; ignores keys it does not know', () => {
    const l = themeLint(ir('customMenu'), undefined)
    expect(l.map((x) => `${x.code}:${x.nodeId}`).sort()).toEqual(['theme-binding-not-runtime:two', 'theme-binding-not-runtime:two', 'theme-binding-not-runtime:txt', 'theme-variable-missing:gone'].sort())
  })
  it('a HUD widget only gets the missing-variable warning: it has no INI', () => {
    expect(themeLint(ir('hudWidget'), undefined).map((x) => x.code)).toEqual(['theme-variable-missing'])
  })
  it('errors on a default theme that is not a mode', () => {
    expect(themeLint(ir('customMenu'), 'Nordic').some((x) => x.code === 'theme-default-unknown')).toBe(false)
    expect(themeLint(ir('customMenu'), 'Midnight').find((x) => x.code === 'theme-default-unknown')).toMatchObject({ severity: 'error', nodeId: 'f' })
  })
  it('does nothing without a themed collection', () => {
    expect(themeLint({ ...ir('customMenu'), themes: undefined }, 'Whatever')).toEqual([])
  })
})
