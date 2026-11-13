import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Theme } from '@inkwell-ui/spec'
import { frame, rectShape, swf, textNode } from '../swf/ir.testutil'
import { createFfdecWrapper } from '../build/ffdecWrapper'
import { compileSwf } from '../swf/compile'
import { generate } from '../swf/generate'
import { themeOps, themeVars } from './themeOps'

const col: Theme = {
  name: 'Colors', modes: ['Vanilla', 'Nordic'],
  variables: {
    A: { name: 'accent', type: 'color', values: { Vanilla: { r: 1, g: 1, b: 1 }, Nordic: { r: 0, g: 0, b: 1 } } },
    O: { name: 'alpha', type: 'number', values: { Vanilla: 100, Nordic: 50 } },
    W: { name: 'wide', type: 'number', values: { Vanilla: 100, Nordic: 300 } }
  }
}
const ir = (kind = 'customMenu') => swf([
  frame('f', ['panel', 'card', 'label', 'big']),
  rectShape('panel', { name: 'panel', parent: 'f', bindings: { 'fills/0/color': { id: 'A' }, opacity: { id: 'O' }, 'transform/width': { id: 'W' } } }),
  frame('card', [], { name: 'card', parent: 'f', fills: [{ type: 'solid', color: { r: 0, g: 0, b: 0 } }], bindings: { 'fills/0/color': { id: 'A' }, 'transform/width': { id: 'W' } } }),
  textNode('label', { name: 'label', parent: 'f', bindings: { 'runs/0/fill/color': { id: 'A' }, 'runs/0/size': { id: 'W' } } }),
  rectShape('big', { name: 'big', parent: 'f', strokes: [{ fill: { type: 'solid', color: { r: 0, g: 0, b: 0 } }, weight: 1, alignment: 'center' }], bindings: { 'fills/0/color': { id: 'A' }, 'strokes/0/color': { id: 'A' } } })
], { target: { kind }, themes: [col] })

describe('themeOps', () => {
  it('lists the runtime bindings with a value per mode: colours as 0xRRGGBB, opacity as percent (a Figma opacity variable is 0 to 100); frame size, text size, strokes and a stroked shape fill are compile time only', () => {
    const ops = themeOps(ir()).map((o) => `${o.nodeId}.${o.target}.${o.kind}`).sort()
    expect(ops).toEqual(['card.fill.a', 'card.fill.c', 'label.self.t', 'panel.self.a', 'panel.self.c', 'panel.self.w'])
    const panel = themeOps(ir()).filter((o) => o.nodeId === 'panel')
    expect(panel.find((o) => o.kind === 'c')!.values).toEqual({ Vanilla: 0xffffff, Nordic: 0x0000ff })
    expect(panel.find((o) => o.kind === 'a')!.values).toEqual({ Vanilla: 100, Nordic: 50 })
  })
  it("a colour variable's alpha is an `a` op: the fill clip's alpha, or a shape's opacity times it", () => {
    const P: Theme = { name: 'Panel', modes: ['Vanilla', 'Nordic'], variables: { P: { name: 'p', type: 'color', values: { Vanilla: { r: 0, g: 0, b: 0, a: 0.7 }, Nordic: { r: 0.1, g: 0.1, b: 0.1, a: 0.95 } } }, O: { name: 'o', type: 'number', values: { Vanilla: 100, Nordic: 50 } } } }
    const black = { type: 'solid', color: { r: 0, g: 0, b: 0 } }
    const i = swf([
      frame('f', ['bg', 'chip', 'plain']),
      frame('bg', [], { name: 'bg', parent: 'f', fills: [black], bindings: { 'fills/0/color': { id: 'P' } } }),
      rectShape('chip', { name: 'chip', parent: 'f', fills: [black], bindings: { 'fills/0/color': { id: 'P' }, opacity: { id: 'O' } } }),
      rectShape('plain', { name: 'plain', parent: 'f', opacity: 0.5, fills: [black], bindings: { 'fills/0/color': { id: 'P' } } })
    ], { target: { kind: 'customMenu' }, themes: [P] })
    const by = (id: string, kind: string) => themeOps(i).find((o) => o.nodeId === id && o.kind === kind)!.values
    expect(by('bg', 'a')).toEqual({ Vanilla: 70, Nordic: 95 })
    expect(by('chip', 'a')).toEqual({ Vanilla: 70, Nordic: 48 }) // 100% and 50% opacity times 0.7 and 0.95 (47.5 rounds up)
    expect(by('plain', 'a')).toEqual({ Vanilla: 35, Nordic: 48 }) // the shape's own opacity 0.5 times the alpha
    // drawn opaque, the default mode's alpha is the clip's placement alpha: nothing is lost without an INI theme
    const g = generate(i, { modId: 'M' })
    expect(g.shapes.find((s) => s.nodeId === 'bg')!.svg).toContain('fill-opacity="1"')
  })
  it('is empty without a themed collection', () => expect(themeOps({ ...ir(), themes: undefined })).toEqual([]))
})

describe('menu class theming', () => {
  const g = generate(ir(), { modId: 'MyMod' })
  const cls = g.as2.find((f) => f.path.endsWith('Menu.as'))!.source
  it('applies the INI theme in begin() and carries one table per mode', () => {
    expect(cls).toContain('this.applyTheme(bridge.theme);')
    expect(cls).toContain('if (name == "Nordic") return [["panel", "c", 255], ["panel", "a", 50], ["panel", "w", 300], ["card.fill", "c", 255], ["label", "t", 255], ["card.fill", "a", 100]];')
    expect(cls).toContain("[Theme] unknown theme '")
  })
  it('wraps a themed shape and a themed frame background in sprites so AS2 can reach them', () => {
    const plain = generate({ ...ir(), nodes: Object.fromEntries(Object.entries(ir().nodes).map(([k, n]) => [k, { ...n, bindings: undefined }])) } as never, { modId: 'MyMod' })
    expect(g.tags.length).toBeGreaterThan(plain.tags.length) // two extra sprite definitions (panel shape, card fill)
  })
  it('a HUD widget and a menu without bindings get no theme code', () => {
    expect(generate(ir('hudWidget'), { modId: 'MyMod' }).as2.some((f) => f.source.includes('applyTheme'))).toBe(false)
    const none = generate({ ...ir(), themes: undefined }, { modId: 'MyMod' })
    expect(none.as2.find((f) => f.path.endsWith('Menu.as'))!.source).not.toContain('applyTheme')
  })
})

const ffdecDir = process.env['INKWELL_FFDEC'] ?? 'C:\\Program Files (x86)\\FFDec'
const javaPath = process.env['INKWELL_JAVA'] ?? 'java'
const jarPath = resolve(__dirname, '../../../tools/ffdec-wrapper/build/ffdec-wrapper.jar')
const can = (() => {
  try {
    execFileSync(javaPath, ['-version'], { stdio: 'ignore' })
  } catch {
    return false
  }
  return existsSync(join(ffdecDir, 'lib', 'ffdec_lib.jar')) && existsSync(jarPath) && existsSync(join(ffdecDir, 'ffdec-cli.jar'))
})()

describe.skipIf(!can)('themed menu through FFDec', () => {
  it('compiles the generated theme code (the AS2 must parse) as the game SWF and as the preview SWF', async () => {
    const ffdec = createFfdecWrapper({ javaPath, ffdecDir, jarPath })
    try {
      for (const preview of [false, true]) {
        const dir = mkdtempSync(join(tmpdir(), 'inkwell-theme-'))
        const r = await compileSwf(ir(), { modId: 'ThemeMod', buildDir: dir, ffdec, ...(preview ? { preview: true } : {}) })
        expect(r.lint.filter((l) => l.severity === 'error')).toEqual([])
        expect(existsSync(r.swfPath)).toBe(true)
      }
    } finally {
      ffdec.stop()
    }
  }, 120_000)
})

describe('themeVars', () => {
  it('every variable by name with its value in every theme; a colour is 0xRRGGBB, the first collection holding a name wins, a single-mode collection fills every theme', () => {
    const fixed: Theme = { name: 'Fixed', modes: ['Only'], variables: { F: { name: 'gap', type: 'number', values: { Only: 8 } }, D: { name: 'accent', type: 'string', values: { Only: 'shadowed' } } } }
    const vars = themeVars({ themes: [col, fixed] })
    const by = Object.fromEntries(vars.map((v) => [v.name, v]))
    expect(by['accent']).toEqual({ name: 'accent', type: 'color', values: { Vanilla: 0xffffff, Nordic: 0x0000ff } })
    expect(by['gap']!.values).toEqual({ Vanilla: 8, Nordic: 8 })
    expect(by['alpha']!.values).toEqual({ Vanilla: 100, Nordic: 50 })
    expect(vars.filter((v) => v.name === 'accent')).toHaveLength(1)
  })
  it('a project without a themed collection has one theme named "" and keeps single-mode variables', () => {
    const fixed: Theme = { name: 'Fixed', modes: ['Only'], variables: { F: { name: 'gap', type: 'number', values: { Only: 8 } } } }
    expect(themeVars({ themes: [fixed] })).toEqual([{ name: 'gap', type: 'number', values: { '': 8 } }])
    expect(themeVars({})).toEqual([])
  })
})
