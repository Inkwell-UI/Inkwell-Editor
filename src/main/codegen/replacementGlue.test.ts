// The engine glue of a menu replacement (SPEC-CHANGES W5) without FFDec: golden AS2 of the glue built from the shipped InventoryMenu contract,
// what it provides to the contract check, where the frame code installs it, and the Inventory contract nodes in a graph. FFDec: replacementGlue.integration.test.ts.
import { resolve } from 'node:path'
import type { ContractLayer } from '@inkwell-ui/spec'
import { beforeAll, describe, expect, it } from 'vitest'
import { defIndex } from '../../shared/graphs'
import { validateGraph } from '../../shared/graphValidate'
import { contractFor, contractsDir, loadContracts } from '../lint/contract'
import { loadPacks } from '../packs'
import { frame, swf, textNode } from '../swf/ir.testutil'
import { generate } from '../swf/generate'
import { corePack, graph, inventoryGraph, loadCore, node } from './codegen.testutil'
import { replacementGlue } from './replacementGlue'

let layers: ContractLayer[]
beforeAll(async () => void (layers = await loadContracts(contractsDir(resolve(__dirname, '../../..')))))

const target = (l: string[]) => ({ kind: 'menuReplacement', contract: 'InventoryMenu', layers: l })
const inventoryIr = (l = ['engine', 'skyui52']) => swf([frame('r', ['m']), { ...frame('m', ['t']), name: 'Menu_mc', parent: 'r' }, { ...textNode('t'), parent: 'm' }] as Parameters<typeof swf>[0], { id: 'inv', target: target(l) })
const merged = (l: string[]) => contractFor(inventoryIr(l), layers)!

describe('replacement glue from the InventoryMenu contract', () => {
  it('golden AS2, engine + SkyUI 5.2', () => {
    expect(replacementGlue(merged(['engine', 'skyui52']), 'MyMod', 'Inv').source).toMatchSnapshot()
  })

  it('provides every fatal and function path of the picked layers except the Figma clip Menu_mc', () => {
    for (const l of [['engine'], ['engine', 'skyui52', 'skyui6']]) {
      const c = merged(l)
      const need = c.entries.filter((e) => e.path && (e.required === 'fatal' || e.required === 'function')).map((e) => e.path!).sort()
      const got = replacementGlue(c, 'M', 'Inv').provided
      expect(need.filter((p) => !got[p])).toEqual(['_root.Menu_mc'])
      expect(got['_root.GetInventoryItemList().entryList']).toBe('Array')
      expect(Object.keys(got).some((p) => p.startsWith('_global.'))).toBe(l.includes('skyui52'))
    }
  })

  it('the SkyUI 5.2 statics are the S-B variant 7 values; unused names (BackgroundAlpha) are left out', () => {
    const src = replacementGlue(merged(['engine', 'skyui52']), 'M', 'Inv').source
    for (const k of ['InventoryMenu', 'ItemCard', 'BottomBar', 'InventoryLists']) expect(src).toContain(`_global.${k} = function() {};\n        _global.${k}.SKYUI_RELEASE_IDX = 2018;\n        _global.${k}.SKYUI_VERSION_STRING = "5.2 SE";`)
    expect(src).not.toContain('BackgroundAlpha')
  })

  it('the preview flavour registers no ExternalInterface callback and traces engine calls', () => {
    const src = replacementGlue(merged(['engine']), 'M', 'Inv', true).source
    expect(src).not.toContain('ExternalInterface')
    expect(src).toContain('engine call')
  })
})

describe('a replacement SWF with Inventory contract nodes', () => {
  it('installs the glue before the graphs register their handlers; the nodes compile without issues', async () => {
    const ir = inventoryIr()
    const g = generate(ir, { modId: 'MyMod', contract: contractFor(ir, layers)!, graphs: { graphs: [inventoryGraph()], packs: await loadCore() } })
    expect(g.lint.filter((l) => l.severity === 'error')).toEqual([])
    const frameCode = g.as2.find((f) => f.path === 'frame_1/DoAction.as')!.source
    expect(frameCode.indexOf('_root.inkwellContract.install();')).toBeLessThan(frameCode.indexOf('this.inkwellGraph0.init();'))
    expect(g.as2.map((f) => f.path)).toContain('__Packages/mods/MyMod/InvContract.as')
    expect(g.graphClasses[0]!.source).toMatchSnapshot()
  })

  it('no glue without a contract, and none for other targets', () => {
    expect(generate({ ...inventoryIr(), target: { kind: 'menuReplacement' } }, { modId: 'M' }).contractProvided).toEqual({})
    const c = contractFor(inventoryIr(), layers)!
    expect(generate({ ...inventoryIr(), target: { kind: 'customMenu' } }, { modId: 'M', contract: c }).as2.some((f) => f.path.endsWith('InvContract.as'))).toBe(false)
  })

  it('contract nodes are errors outside a replacement of their contract; runtime nodes warn in a replacement', async () => {
    const defs = defIndex(await loadPacks([corePack]))
    const g = inventoryGraph()
    const codes = (ctx: Parameters<typeof validateGraph>[1]) => [...new Set(validateGraph(g, ctx).map((i) => `${i.level}:${i.code}`))]
    expect(codes({ defs, target: 'menuReplacement', contract: 'InventoryMenu' })).toEqual([])
    expect(codes({ defs, target: 'customMenu' })).toEqual(['error:contract-node-target'])
    expect(codes({ defs, target: 'menuReplacement', contract: 'MagicMenu' })).toEqual(['error:contract-node-target'])
    const open = graph('o', [node('o', 'core/OnOpen@1')], [])
    expect(validateGraph(open, { defs, target: 'menuReplacement', contract: 'InventoryMenu' }).map((i) => `${i.level}:${i.code}`)).toEqual(['warning:runtime-required'])
  })
})
