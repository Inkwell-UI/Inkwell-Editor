import { beforeEach, describe, expect, it } from 'vitest'
import type { ProjectState } from '../../shared/projectState'
import { applyOverrides } from '../workspace/layout'
import { BEHAVIOUR_PREVIEW_HEIGHT, WORKSPACES } from '../workspace/workspaces'
import { resolveActiveSwf, useProjectStore } from './projectStore'
import { useSelectionStore } from './selectionStore'
import { useSettingsStore } from './settingsStore'
import { useTimingStore } from './timingStore'
import { sanitizePersisted, useWorkspaceStore } from './workspaceStore'

beforeEach(() => {
  useSelectionStore.getState().clear()
  useSettingsStore.setState({ mirrorFigma: true })
  useWorkspaceStore.setState({ ...sanitizePersisted(undefined) })
})

describe('selection store', () => {
  it('applies the table: navigator keeps the graph node; graph sets both', () => {
    const s = useSelectionStore.getState()
    s.selectGraphNode('g1', 'a')
    s.selectComponent('b', 'navigator')
    expect(useSelectionStore.getState()).toMatchObject({ component: 'b', graphNode: 'g1', inspects: 'component', origin: 'local' })
  })
  it('a lint row for a graph node selects it and asks the Graph panel to reveal it (each request is new)', () => {
    const s = useSelectionStore.getState()
    s.selectFromLint({ key: 'k', nodeId: 'x', graphNode: 'n1', graph: 'main' })
    expect(useSelectionStore.getState()).toMatchObject({ component: 'x', graphNode: 'n1', graph: 'main', inspects: 'graphNode', reveal: { graph: 'main', node: 'n1', n: 1 } })
    s.revealGraphNode('main', 'n1')
    expect(useSelectionStore.getState().reveal?.n).toBe(2)
    s.selectComponent('y', 'navigator')
    expect(useSelectionStore.getState()).toMatchObject({ component: 'y', graphNode: 'n1', graph: 'main' })
  })
  it('lint selection highlights the issue and a later click clears it', () => {
    useSelectionStore.getState().selectFromLint({ key: 'k', nodeId: 'x' })
    expect(useSelectionStore.getState().issue).toBe('k')
    useSelectionStore.getState().selectComponent('y', 'stage')
    expect(useSelectionStore.getState().issue).toBeUndefined()
  })
  it('Figma mirroring respects the setting and is marked remote', () => {
    const swfs = [{ swfId: 'A', has: (i: string) => i === '1' }]
    useSettingsStore.getState().setMirrorFigma(false)
    expect(useSelectionStore.getState().applyFigmaSelection(['1'], swfs, 'A')).toBeUndefined()
    expect(useSelectionStore.getState().component).toBeUndefined()
    useSettingsStore.getState().setMirrorFigma(true)
    expect(useSelectionStore.getState().applyFigmaSelection(['1'], swfs, 'A')).toEqual({ swfId: 'A', nodeId: '1' })
    expect(useSelectionStore.getState()).toMatchObject({ component: '1', origin: 'remote' })
  })
  it('prune clears a vanished component', () => {
    useSelectionStore.getState().selectComponent('gone', 'navigator')
    useSelectionStore.getState().prune(() => false)
    expect(useSelectionStore.getState().inspects).toBe('none')
  })
})

describe('workspace store', () => {
  it('each workspace remembers its own sizes and tabs', () => {
    const s = useWorkspaceStore.getState()
    s.setSizes('a|b', [1, 2])
    s.setActive('behaviour')
    useWorkspaceStore.getState().setSizes('a|b', [3, 4])
    expect(useWorkspaceStore.getState().sizes).toMatchObject({ layout: { 'a|b': [1, 2] }, behaviour: { 'a|b': [3, 4] }, localization: {} })
    useWorkspaceStore.getState().setSizes('a|b', undefined)
    expect(useWorkspaceStore.getState().sizes.behaviour).toEqual({})
  })
  it('showDockTab opens the dock tab of the active workspace', () => {
    useWorkspaceStore.getState().showDockTab('lintBudget')
    expect(Object.values(useWorkspaceStore.getState().tabs.layout)).toEqual(['lintBudget'])
    expect(Object.keys(useWorkspaceStore.getState().tabs.layout)[0]).toBe('lintBudget')
    useWorkspaceStore.getState().showDockTab('preview') // not in a tab group: ignored
    expect(Object.keys(useWorkspaceStore.getState().tabs.layout)).toHaveLength(1)
    expect(WORKSPACES.behaviour.layout.kind).toBe('split')
  })
  it('sanitizePersisted drops garbage', () => {
    const p = sanitizePersisted({ active: 'nope', sizes: { layout: { 'navigator|preview|inspector': [1, 2, 3], 'navigator|lintBudget': [0], 'navigator|inspector': 'x', stale: [1, 2] } }, tabs: { localization: { k: 'p', j: 3 } } })
    expect(p.active).toBe('layout')
    expect(p.sizes.layout).toEqual({ 'navigator|preview|inspector': [1, 2, 3] })
    expect(p.tabs.localization).toEqual({ k: 'p' })
    expect(sanitizePersisted(42).active).toBe('layout')
  })
  it('sizes stored for the old Behaviour layout (preview strip over graph, inspector at the right) do not touch the new one', () => {
    const p = sanitizePersisted({
      sizes: { behaviour: { 'navigator|preview|inspector': [1, 5, 2], 'preview|graph': [3, 2], 'navigator|play': [5, 1.4] }, layout: { 'navigator|preview|inspector': [1, 5, 2] } }
    })
    expect(p.sizes.behaviour).toEqual({ 'navigator|play': [5, 1.4] }) // main/dock split still exists, the two moved ones are gone
    expect(p.sizes.layout).toEqual({ 'navigator|preview|inspector': [1, 5, 2] }) // other modes untouched
    const layout = applyOverrides(WORKSPACES.behaviour.layout, { sizes: p.sizes.behaviour })
    expect(JSON.stringify(layout)).toContain('"fixed":' + BEHAVIOUR_PREVIEW_HEIGHT)
  })
})

describe('project store', () => {
  const swf = (id: string, orphaned = false) => ({ id, name: id, orphaned }) as never
  it('resolves the active swf: wanted, else first non-orphaned, else first', () => {
    expect(resolveActiveSwf([swf('a', true), swf('b')], 'zzz')).toBe('b')
    expect(resolveActiveSwf([swf('a', true)], undefined)).toBe('a')
    expect(resolveActiveSwf([swf('a'), swf('b')], 'b')).toBe('b')
    expect(resolveActiveSwf([], 'b')).toBeUndefined()
  })
  it('keeps the active swf across pushes and falls back when it disappears', () => {
    const p = (ids: string[]): ProjectState => ({ dir: 'd', name: 'n', modId: 'm', strictMode: false, swfs: ids.map((i) => swf(i)) })
    useProjectStore.getState().setProject(p(['a', 'b']))
    useProjectStore.getState().setActiveSwf('b')
    useProjectStore.getState().setProject(p(['a', 'b']))
    expect(useProjectStore.getState().activeSwfId).toBe('b')
    useProjectStore.getState().setProject(p(['a']))
    expect(useProjectStore.getState().activeSwfId).toBe('a')
    useProjectStore.getState().setProject(null)
    expect(useProjectStore.getState().activeSwfId).toBeUndefined()
  })
})

describe('timing store', () => {
  it('records builds and attaches the preview time', () => {
    useTimingStore.getState().record({ seq: 1, swfName: 'a', stages: {}, total: 5 })
    useTimingStore.getState().setPreviewMs(1, 9)
    expect(useTimingStore.getState().history[0]!.previewMs).toBe(9)
  })
})
