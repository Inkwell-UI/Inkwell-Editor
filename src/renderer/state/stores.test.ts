import { beforeEach, describe, expect, it } from 'vitest'
import type { ProjectState } from '../../shared/projectState'
import { WORKSPACES } from '../workspace/workspaces'
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
    s.setActive('verify')
    useWorkspaceStore.getState().setSizes('a|b', [3, 4])
    expect(useWorkspaceStore.getState().sizes).toMatchObject({ wire: { 'a|b': [1, 2] }, verify: { 'a|b': [3, 4] }, debug: {} })
    useWorkspaceStore.getState().setSizes('a|b', undefined)
    expect(useWorkspaceStore.getState().sizes.verify).toEqual({})
  })
  it('showDockTab opens the dock tab of the active workspace', () => {
    useWorkspaceStore.getState().showDockTab('lintBudget')
    expect(Object.values(useWorkspaceStore.getState().tabs.wire)).toEqual(['lintBudget'])
    expect(Object.keys(useWorkspaceStore.getState().tabs.wire)[0]).toBe('lintBudget|localization|trace|mockData')
    useWorkspaceStore.getState().showDockTab('preview') // not in a tab group: ignored
    expect(Object.keys(useWorkspaceStore.getState().tabs.wire)).toHaveLength(1)
    expect(WORKSPACES.debug.layout.kind).toBe('split')
  })
  it('sanitizePersisted drops garbage', () => {
    const p = sanitizePersisted({ active: 'nope', sizes: { wire: { ok: [1, 2], bad: [0], worse: 'x' } }, tabs: { debug: { k: 'p', j: 3 } } })
    expect(p.active).toBe('wire')
    expect(p.sizes.wire).toEqual({ ok: [1, 2] })
    expect(p.tabs.debug).toEqual({ k: 'p' })
    expect(sanitizePersisted(42).active).toBe('wire')
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
