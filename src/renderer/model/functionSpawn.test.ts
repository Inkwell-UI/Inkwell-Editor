import { matchesSpawn } from '@nicklaj/knotwork'
import { describe, expect, it } from 'vitest'
import { newFunctionGraph } from '../../shared/functions'
import { functionOfOption, functionOption } from './functionSpawn'

const fn = (id: string, name: string) => newFunctionGraph(id, name, () => 'x')

describe('functions in the Add Node search', () => {
  it('"f PlusOne" matches the function named PlusOne, not the others', () => {
    const plus = functionOption(fn('plus-one', 'PlusOne'))
    const other = functionOption(fn('fade', 'Fade'))
    expect(matchesSpawn(plus, 'f PlusOne')).toBe(true)
    expect(matchesSpawn(other, 'f PlusOne')).toBe(false)
    expect(matchesSpawn(plus, 'f ')).toBe(true) // "f " alone lists every function
  })

  it('a pack function shows its pack, and the option leads back to the graph id', () => {
    const o = functionOption({ ...fn('inc', 'Inc'), id: 'my-pack/inc' })
    expect(o.label).toBe('Inc (my-pack)')
    expect(functionOfOption(o)).toBe('my-pack/inc')
    expect(functionOfOption({ def: { kind: 'core/Log@1', category: 'x', title: 'Log', keywords: [], pins: [] }, label: 'Log' })).toBeUndefined()
  })
})
