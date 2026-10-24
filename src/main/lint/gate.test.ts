import { describe, expect, it } from 'vitest'
import type { DeployLintItem } from '../../shared/deploy'
import { exportGate } from './gate'

const row = (severity: DeployLintItem['severity'], code = 'x'): DeployLintItem => ({ severity, code, message: code, swf: 'hud', nodeId: '1:2' })

describe('exportGate', () => {
  it('an error blocks', () => {
    const g = exportGate([row('error', 'font-unmapped'), row('warning')], false)
    expect(g).toMatchObject({ ok: false, strict: false })
    expect(g.blocking.map((r) => r.code)).toEqual(['font-unmapped'])
    expect(g.blocking[0]!.nodeId).toBe('1:2')
  })
  it('warnings pass and are listed', () => {
    expect(exportGate([row('warning', 'font-fallback')], false)).toMatchObject({ ok: true, blocking: [], warnings: [{ code: 'font-fallback' }] })
  })
  it('Strict Mode blocks a warning', () => {
    const g = exportGate([row('warning', 'font-fallback')], true)
    expect(g).toMatchObject({ ok: false, strict: true, warnings: [] })
    expect(g.blocking).toEqual([{ ...row('warning', 'font-fallback'), severity: 'error' }])
  })
  it('info never blocks, strict or not', () => {
    for (const strict of [false, true]) expect(exportGate([row('info', 'node-hidden')], strict)).toMatchObject({ ok: true, info: [{ code: 'node-hidden' }] })
  })
  it('no issues pass', () => expect(exportGate([], true).ok).toBe(true))
})
