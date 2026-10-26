import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyGraph, summarize } from '../../shared/graphs'
import { resetGraphDocs } from './graphDocs'
import { findGraphStore, setGraphSaver } from './graphStore'
import { discardOverlayOrphan, relinkOverlayOrphan } from './orphanActions'
import { getOverlayDoc, getOverlayStore, redoSwf, resetOverlays, setOverlaySaver, undoSwf } from './overlayStore'

const g = emptyGraph('main', 'Main', 'menu')
g.nodes.push({ id: 'n1', kind: 'SetText', pos: { x: 0, y: 0 }, fields: { target: 'OLD', text: 'hi' } })
const api = {
  listGraphs: vi.fn(async () => ({ ok: true as const, graphs: [summarize(g)] })),
  loadGraph: vi.fn(async () => ({ ok: true as const, graph: structuredClone(g) })),
  createGraph: vi.fn(),
  deleteGraph: vi.fn()
}
const swf = { id: 'swf', name: 'Hud' }
const nodes = (): Record<string, Record<string, unknown>> => getOverlayDoc('swf')?.nodes ?? {}

beforeEach(() => {
  resetGraphDocs()
  resetOverlays()
  setOverlaySaver(undefined)
  setGraphSaver(undefined)
  getOverlayStore('swf', 'Hud', { specVersion: 6, nodes: { OLD: { role: 'button', scripts: ['main'], extra: 7 }, TAKEN: { role: 'text' } } })
})

describe('orphaned overlay entries', () => {
  it('Discard removes the entry and undo brings it back', () => {
    discardOverlayOrphan('swf', 'OLD')
    expect(nodes()['OLD']).toBeUndefined()
    expect(nodes()['TAKEN']).toBeDefined()
    undoSwf('swf')
    expect(nodes()['OLD']).toEqual({ role: 'button', scripts: ['main'], extra: 7 })
  })

  it('Relink moves the whole entry (unknown keys too) and retargets graph nodes; undo reverts the overlay', async () => {
    expect(await relinkOverlayOrphan(swf, 'OLD', 'NEW', api)).toEqual({ ok: true })
    expect(nodes()['OLD']).toBeUndefined()
    expect(nodes()['NEW']).toEqual({ role: 'button', scripts: ['main'], extra: 7 })
    expect(findGraphStore('swf', 'main')!.getState().nodes[0]!.data.fields).toEqual({ target: 'NEW', text: 'hi' })
    undoSwf('swf') // the overlay move was recorded last
    expect(nodes()['OLD']).toBeDefined()
    redoSwf('swf')
    expect(nodes()['NEW']).toBeDefined()
  })

  it('Relink refuses a target that has behavior, the same id and a missing entry, and changes nothing', async () => {
    expect(await relinkOverlayOrphan(swf, 'OLD', 'TAKEN', api)).toEqual({ ok: false, error: 'taken' })
    expect(await relinkOverlayOrphan(swf, 'OLD', 'OLD', api)).toEqual({ ok: false, error: 'same' })
    expect(await relinkOverlayOrphan(swf, 'NOPE', 'NEW', api)).toEqual({ ok: false, error: 'missing' })
    expect(nodes()['OLD']).toBeDefined()
    expect(nodes()['TAKEN']).toEqual({ role: 'text' })
  })
})
