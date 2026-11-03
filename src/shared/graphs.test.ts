import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadPacks } from '../main/packs'
import { defIndex, graphLayersOf, newGraph } from './graphs'
import { validateGraph } from './graphValidate'

describe('newGraph', () => {
  it('starts with one unconnected On Load of the core pack, and is lint-clean in every target', async () => {
    const defs = defIndex(await loadPacks([resolve(__dirname, '../../resources/packs/core')]))
    for (const scope of ['menu', 'component'] as const) {
      const g = newGraph('g', 'G', scope)
      expect(g.nodes).toHaveLength(1)
      expect(g.nodes[0]).toMatchObject({ kind: 'core/OnLoad@1', fields: {} })
      expect(defs.has(g.nodes[0]!.kind)).toBe(true)
      for (const target of ['hudWidget', 'customMenu', 'menuReplacement'] as const) expect(validateGraph(g, { defs, target })).toEqual([])
    }
  })
})

describe('graphLayersOf', () => {
  it('maps each graph id to the layer whose overlay lists it in scripts', () => {
    expect(graphLayersOf({ a: { scripts: ['g1', 'g2'] }, b: {}, c: { scripts: ['g3'] } })).toEqual({ g1: 'a', g2: 'a', g3: 'c' })
    expect(graphLayersOf(undefined)).toEqual({})
  })
})
