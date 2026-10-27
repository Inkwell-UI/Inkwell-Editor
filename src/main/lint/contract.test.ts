import { resolve } from 'node:path'
import type { ContractLayer } from '@inkwell-ui/spec'
import { beforeAll, describe, expect, it } from 'vitest'
import { generate } from '../swf/generate'
import { frame, rectShape, swf } from '../swf/ir.testutil'
import { contractLint, contractsDir, loadContracts } from './contract'

let layers: ContractLayer[]
beforeAll(async () => void (layers = await loadContracts(contractsDir(resolve(__dirname, '../../..')))))

const named = (n: ReturnType<typeof frame>, name: string) => ({ ...n, name, parent: 'r' }) as typeof n
const replacement = (menuMc: ReturnType<typeof frame> | undefined, target: Record<string, unknown> = { kind: 'menuReplacement', contract: 'InventoryMenu' }) => {
  const ir = swf(menuMc ? [frame('r', [menuMc.id]), menuMc] : [frame('r', [])], { target })
  return contractLint(ir, generate(ir, { modId: 'M' }).layerPaths, layers)
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

  it('base skyui adds the SkyUI 5.2 globals; vanilla does not', () => {
    const sky = replacement(undefined, { kind: 'menuReplacement', contract: 'InventoryMenu', base: 'skyui' })
    expect(sky.filter((x) => x.message.startsWith('_global.'))).toHaveLength(8)
    expect(sky.find((x) => x.message.startsWith('_global.ItemCard.SKYUI_RELEASE_IDX'))!.message).toContain('= 2018')
    expect(replacement(undefined, { kind: 'menuReplacement', contract: 'InventoryMenu', base: 'vanilla' }).some((x) => x.message.startsWith('_global.'))).toBe(false)
  })

  it('no contract is a warning, an unknown one an error, and other targets are never checked', () => {
    expect(rows(replacement(undefined, { kind: 'menuReplacement' }))).toEqual(['warning:contract-none:This'])
    expect(rows(replacement(undefined, { kind: 'menuReplacement', contract: 'NoSuchMenu' }))).toEqual(['error:contract-unknown:No'])
    for (const kind of ['hudWidget', 'customMenu']) expect(replacement(undefined, { kind, contract: 'InventoryMenu' })).toEqual([])
  })
})
