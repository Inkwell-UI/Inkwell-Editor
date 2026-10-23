import { beforeEach, describe, expect, it } from 'vitest'
import { editNode, getOverlayStore, redoSwf, resetOverlays, setOverlaySaver, undoSwf } from './overlayStore'

const saved: [string, unknown][] = []
beforeEach(() => {
  resetOverlays()
  saved.length = 0
  setOverlaySaver((n, d) => void saved.push([n, d]))
})

describe('overlay store (one zundo history per swf)', () => {
  it('edits, undoes and redoes, saving every change; unknown keys survive', () => {
    const s = getOverlayStore('a', 'Menu', { specVersion: 3, future: { k: 1 }, nodes: { '1': { role: 'text', extra: 7 } } })
    editNode('a', '1', { instanceName: 'Title' })
    expect(s.getState().doc.nodes!['1']).toEqual({ role: 'text', extra: 7, instanceName: 'Title' })
    expect(s.getState().doc['future']).toEqual({ k: 1 })
    undoSwf('a')
    expect(s.getState().doc.nodes!['1']).toEqual({ role: 'text', extra: 7 })
    redoSwf('a')
    expect(s.getState().doc.nodes!['1']!['instanceName']).toBe('Title')
    expect(saved.map((x) => x[0])).toEqual(['Menu', 'Menu', 'Menu'])
  })
  it('each swf has its own history', () => {
    getOverlayStore('a', 'A', { specVersion: 3, nodes: {} })
    const b = getOverlayStore('b', 'B', { specVersion: 3, nodes: {} })
    editNode('a', '1', { role: 'button' })
    editNode('b', '1', { role: 'list' })
    undoSwf('a')
    expect(b.getState().doc.nodes!['1']).toEqual({ role: 'list' })
    expect(getOverlayStore('a', 'A', { specVersion: 3, nodes: { x: {} } }).getState().doc.nodes).toEqual({}) // not re-initialised by a later push
  })
  it('a renamed swf saves under its new name', () => {
    getOverlayStore('a', 'Old', { specVersion: 3, nodes: {} })
    getOverlayStore('a', 'New', { specVersion: 3, nodes: {} })
    editNode('a', '1', { role: 'x' })
    expect(saved[0]![0]).toBe('New')
  })
})
