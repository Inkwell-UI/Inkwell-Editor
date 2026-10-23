import { describe, expect, it } from 'vitest'
import { flattenReports } from '../../shared/syncState'
import { toReport } from './buildPipeline'

const font = (swfId: string, nodeName: string) => ({ swfId, nodeId: '1:' + nodeName, nodeName, figmaFont: 'Everywhere/Medium', alias: '$EverywhereMediumFont', via: 'family/style' as const })
const lint = (nodeId: string, severity: 'error' | 'warning') => ({ severity, code: 'c', message: 'm', nodeId, nodeName: 'L' + nodeId })

describe('per-swf reports', () => {
  it('two swfs keep separate rows; rebuilding one replaces only its own; errors sort first', () => {
    const reports = new Map()
    reports.set('a', toReport('a', 'Menu', { fonts: [font('a', 'Title')], lint: [lint('1', 'warning')] }))
    reports.set('b', toReport('b', 'Hud', { fonts: [font('b', 'Ammo')], lint: [lint('2', 'error')] }))
    let r = flattenReports(reports.values())
    expect(r.fonts.map((f) => [f.swfName, f.layerName])).toEqual([['Menu', 'Title'], ['Hud', 'Ammo']])
    expect(r.lint.map((l) => [l.severity, l.swfName, l.layerName])).toEqual([['error', 'Hud', 'L2'], ['warning', 'Menu', 'L1']])
    reports.set('a', toReport('a', 'Menu', { fonts: [], lint: [] }))
    r = flattenReports(reports.values())
    expect(r.fonts).toHaveLength(1)
    expect(r.fonts[0]!.swfName).toBe('Hud')
  })
})
