import { describe, expect, it } from 'vitest'
import { generate } from './generate'
import { buildSheet, VARIANTS } from '../../../scripts/ingame-test-sheet'

describe('ingame test sheet', () => {
  it.each(VARIANTS)('$id validates and compiles without lint errors', (v) => {
    const g = generate(buildSheet(v.id, v.name, v.width, v.height), { modId: 'IngameTest' })
    expect(g.lint.filter((l) => l.severity === 'error')).toEqual([])
  })
})
