import { describe, expect, it } from 'vitest'
import { promoteStrict } from './lint'
import { ident, instanceNameError, normalizeOverlay, overlayProblems, patchNodeOverlay } from './overlay'

describe('instance names', () => {
  it('default is the sanitized layer name (same function as the compiler)', () => {
    expect(ident('Damage Val (Txt)')).toBe('Damage_Val__Txt_')
    expect(ident('1st')).toBe('_1st')
  })
  it('only identifiers are valid', () => {
    expect(instanceNameError('DamageVal_Txt')).toBeUndefined()
    expect(instanceNameError('')).toBe('empty')
    expect(instanceNameError('has space')).toBe('invalid')
    expect(instanceNameError('1abc')).toBe('invalid')
  })
})

describe('overlay patching', () => {
  it('adds specVersion to an old overlay and keeps every unknown key', () => {
    const n = normalizeOverlay({ bindings: [], version: 1, nodes: { a: { unknownField: null } } })
    expect(n).toMatchObject({ bindings: [], version: 1, specVersion: 3, nodes: { a: { unknownField: null } } })
  })
  it('sets and removes keys; an emptied entry is dropped; other entries are untouched', () => {
    let d = patchNodeOverlay({ specVersion: 3, nodes: { b: { role: 'list' } } }, 'a', { role: 'button', instanceName: 'Ok' })
    expect(d.nodes).toEqual({ a: { role: 'button', instanceName: 'Ok' }, b: { role: 'list' } })
    d = patchNodeOverlay(d, 'a', { role: null, instanceName: null })
    expect(d.nodes).toEqual({ b: { role: 'list' } })
  })
  it('an entry that only holds unknown keys stays', () => {
    const d = patchNodeOverlay({ specVersion: 3, nodes: { a: { role: 'x', future: 1 } } }, 'a', { role: null })
    expect(d.nodes).toEqual({ a: { future: 1 } })
  })
  it('validates before a write', () => {
    expect(overlayProblems({ specVersion: 3, nodes: { a: { instanceName: 'ok' } } })).toEqual([])
    expect(overlayProblems({ nodes: { a: { instanceName: 'not ok' } } })).toHaveLength(1)
    expect(overlayProblems({ nodes: { a: { role: 1 } } })).toHaveLength(1)
    expect(overlayProblems([])).toHaveLength(1)
  })
})

describe('promoteStrict', () => {
  it('turns warnings into errors only when strict; info stays', () => {
    const rows = [{ severity: 'warning', n: 1 }, { severity: 'info', n: 2 }, { severity: 'error', n: 3 }]
    expect(promoteStrict(rows, false)).toEqual(rows)
    expect(promoteStrict(rows, true).map((r) => r.severity)).toEqual(['error', 'info', 'error'])
    expect(rows[0]!.severity).toBe('warning') // input untouched
  })
})
