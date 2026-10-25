import { SPEC_VERSION } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { promoteStrict } from './lint'
import { debugHotkeyOf, ident, instanceNameError, isSettableText, normalizeOverlay, overlayProblems, patchNodeOverlay, widgetAnchorOf } from './overlay'

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
    expect(n).toMatchObject({ bindings: [], version: 1, specVersion: SPEC_VERSION, nodes: { a: { unknownField: null } } })
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

describe('widget anchor override and settable texts', () => {
  it('parses an anchor (missing x/y = 0) and rejects malformed ones, which overlayProblems reports', () => {
    expect(widgetAnchorOf({ anchor: { h: 'right', v: 'top', x: 24, y: 24 } })).toEqual({ h: 'right', v: 'top', x: 24, y: 24 })
    expect(widgetAnchorOf({ anchor: { h: 'left', v: 'bottom' } })).toEqual({ h: 'left', v: 'bottom', x: 0, y: 0 })
    for (const a of [{ h: 'stretch', v: 'top' }, { h: 'left', v: 'top', x: '4' }, 'right', null]) expect(widgetAnchorOf({ anchor: a })).toBeUndefined()
    expect(widgetAnchorOf(undefined)).toBeUndefined()
    expect(overlayProblems({ nodes: { a: { anchor: { h: 'left', v: 'top', x: 1, y: 2 } } } })).toEqual([])
    expect(overlayProblems({ nodes: { a: { anchor: { h: 'up', v: 'top' } } } })).toEqual([expect.stringContaining('overlay.nodes.a.anchor')])
  })
  it('anchor is patched like the other keys', () => {
    const d = patchNodeOverlay({ nodes: {} }, 'f', { anchor: { h: 'right', v: 'top', x: 24, y: 24 } })
    expect(d.nodes).toEqual({ f: { anchor: { h: 'right', v: 'top', x: 24, y: 24 } } })
    expect(patchNodeOverlay(d, 'f', { anchor: null }).nodes).toEqual({})
  })
  it('debugHotkey: scan code 1..255, otherwise 0 (off) and reported', () => {
    expect(debugHotkeyOf({ debugHotkey: 65 })).toBe(65)
    for (const k of [0, 256, 6.5, '65', undefined]) expect(debugHotkeyOf({ debugHotkey: k })).toBe(0)
    expect(overlayProblems({ nodes: { f: { debugHotkey: 65 } } })).toEqual([])
    expect(overlayProblems({ nodes: { f: { debugHotkey: 0 } } })).toEqual([expect.stringContaining('debugHotkey')])
  })
  it('role text makes a layer settable', () => {
    expect(isSettableText({ role: 'text' })).toBe(true)
    expect(isSettableText({ role: 'button' })).toBe(false)
    expect(isSettableText(undefined)).toBe(false)
  })
})
