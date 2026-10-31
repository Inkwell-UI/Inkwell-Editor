import { describe, expect, it } from 'vitest'
import { resolvePins } from '../../shared/graphValidate'
import { generateGraphClasses } from './codegen'
import { graph, loadCore, node, wire } from './codegen.testutil'

const packs = await loadCore()
const def = packs.defs.get('core/MakeObject@1')!
const names = (fields: Record<string, unknown>): string[] => resolvePins(def, { fields }, []).inputs.map((p) => p.name)

describe('Make Object pairs', () => {
  it('has 4 pairs unless the field says otherwise, held between 1 and 16, with the value type of the node', () => {
    expect(names({})).toEqual(['key0', 'value0', 'key1', 'value1', 'key2', 'value2', 'key3', 'value3'])
    expect(names({ pairs: 2 })).toEqual(['key0', 'value0', 'key1', 'value1'])
    expect(names({ pairs: 0 })).toHaveLength(2)
    expect(names({ pairs: 99 })).toHaveLength(32)
    expect(resolvePins(def, { fields: { pairs: 1, valueType: 'Number' } }, []).inputs.map((p) => p.type)).toEqual(['String', 'Number'])
  })

  it('builds the object from exactly the pairs it has', () => {
    const g = graph('main', [node('ol', 'core/OnLoad@1'), node('mo', 'core/MakeObject@1', { pairs: 2, valueType: 'String' }), node('lg', 'core/Log@1', { level: 'info' })], [wire('ol', 'then', 'lg', 'in')])
    const r = generateGraphClasses({ modId: 'M', swfCls: 'T', graphs: [g], packs, layerPath: () => undefined })
    expect(r.issues).toEqual([])
  })
})
