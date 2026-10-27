import { describe, expect, it } from 'vitest'
import { flowLine } from './devLink'

describe('flowLine', () => {
  it('turns the reserved pins into the preview trace lines', () => {
    expect(flowLine('n', '$run', 3)).toBe('[Inkwell] run n')
    expect(flowLine('d', '$timer', '7 wait 2500 my key')).toBe('[Inkwell] wait d 2500 my key')
    expect(flowLine('d', '$timer', '8 waited')).toBe('[Inkwell] waited d')
    expect(flowLine('x', '$timer', '9 cancel slow')).toBe('[Inkwell] cancel slow')
  })
  it('ignores any other pin and a malformed timer value', () => {
    expect(flowLine('n', 'value', 3)).toBeUndefined()
    expect(flowLine('n', '$timer', 'garbage')).toBeUndefined()
    expect(flowLine('n', '$timer', 5)).toBeUndefined()
  })
})
