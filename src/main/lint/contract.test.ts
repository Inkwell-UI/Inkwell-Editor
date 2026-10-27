import { resolve } from 'node:path'
import type { ContractLayer } from '@inkwell-ui/spec'
import { beforeAll, describe, expect, it } from 'vitest'
import { generate } from '../swf/generate'
import { frame, rectShape, swf } from '../swf/ir.testutil'
import { contractFor, contractLint, contractsDir, layersProblem, loadContracts } from './contract'

let layers: ContractLayer[]
beforeAll(async () => void (layers = await loadContracts(contractsDir(resolve(__dirname, '../../..')))))

const named = (n: ReturnType<typeof frame>, name: string) => ({ ...n, name, parent: 'r' }) as typeof n
const replacement = (menuMc: ReturnType<typeof frame> | undefined, target: Record<string, unknown> = { kind: 'menuReplacement', contract: 'InventoryMenu' }, glue = false) => {
  const ir = swf(menuMc ? [frame('r', [menuMc.id]), menuMc] : [frame('r', [])], { target })
  const contract = glue ? contractFor(ir, layers) : undefined
  const g = generate(ir, { modId: 'M', ...(contract ? { contract } : {}) })
  return contractLint(ir, g.layerPaths, layers, g.contractProvided)
}
const rows = (l: ReturnType<typeof contractLint>) => l.map((x) => `${x.severity}:${x.code}:${x.message.split(' ')[0]}`)

describe('contractLint (shipped InventoryMenu contract)', () => {
  it('the shipped copy matches the Spec (yarn sync:contracts) and has the three layers', () => {
    expect(layers.filter((l) => l.menu === 'InventoryMenu').map((l) => l.layer).sort()).toEqual(['engine', 'skyui52', 'skyui6'])
  })

  it('a replacement without Menu_mc and glue gets the fatal and bridge errors; members wait for their function', () => {
    expect(rows(replacement(undefined))).toEqual(['error:contract-missing:_root.GetInventoryItemList', 'error:contract-missing:_root.Menu_mc', 'error:contract-missing:_root.call', 'error:contract-missing:_root.respond'])
  })

  it('a frame named Menu_mc satisfies the clip; a shape is the wrong type and the finding sits on that layer', () => {
    expect(rows(replacement(named(frame('m', []), 'Menu_mc')))).not.toContain('error:contract-missing:_root.Menu_mc')
    const wrong = replacement(named(rectShape('m') as ReturnType<typeof frame>, 'Menu_mc')).find((x) => x.code === 'contract-wrong-type')
    expect(wrong).toMatchObject({ severity: 'error', nodeId: 'm', message: expect.stringContaining('compiles as a Shape') })
  })

  it('layers with skyui52 add the SkyUI 5.2 globals; engine alone does not', () => {
    const sky = replacement(undefined, { kind: 'menuReplacement', contract: 'InventoryMenu', layers: ['engine', 'skyui52', 'skyui6'] })
    expect(sky.filter((x) => x.message.startsWith('_global.'))).toHaveLength(8)
    expect(sky.find((x) => x.message.startsWith('_global.ItemCard.SKYUI_RELEASE_IDX'))!.message).toContain('= 2018')
    expect(replacement(undefined, { kind: 'menuReplacement', contract: 'InventoryMenu', layers: ['engine'] }).some((x) => x.message.startsWith('_global.'))).toBe(false)
  })

  it('with the generated glue only the Figma clip Menu_mc is left to the designer, with or without SkyUI 5.2', () => {
    expect(rows(replacement(undefined, undefined, true))).toEqual(['error:contract-missing:_root.Menu_mc'])
    expect(replacement(named(frame('m', []), 'Menu_mc'), { kind: 'menuReplacement', contract: 'InventoryMenu', layers: ['engine', 'skyui52'] }, true)).toEqual([])
  })

  it('target.layers must be known names, once each, engine first', () => {
    expect(layersProblem(['engine', 'skyui52'])).toBeUndefined()
    expect(layersProblem(['skyui52'])).toMatch(/start with "engine"/)
    expect(layersProblem(['engine', 'engine'])).toMatch(/twice/)
    expect(layersProblem(['engine', 'skyui7'])).toMatch(/unknown layer "skyui7"/)
    expect(layersProblem(['engine', 'mod'])).toMatch(/unknown layer "mod"/)
    expect(rows(replacement(undefined, { kind: 'menuReplacement', contract: 'InventoryMenu', layers: ['skyui52'] }))).toEqual(['error:contract-layers:target.layers'])
  })

  it('no contract is a warning, an unknown one an error, and other targets are never checked', () => {
    expect(rows(replacement(undefined, { kind: 'menuReplacement' }))).toEqual(['warning:contract-none:This'])
    expect(rows(replacement(undefined, { kind: 'menuReplacement', contract: 'NoSuchMenu' }))).toEqual(['error:contract-unknown:No'])
    for (const kind of ['hudWidget', 'customMenu']) expect(replacement(undefined, { kind, contract: 'InventoryMenu' })).toEqual([])
  })
})
