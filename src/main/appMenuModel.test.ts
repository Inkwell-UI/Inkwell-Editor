import { describe, expect, it, vi } from 'vitest'
import { appMenuModel } from './appMenuModel'

describe('appMenuModel', () => {
  it('turns a template into entries with paths as ids and registers what each entry runs', () => {
    const actions = new Map<string, () => void>()
    const save = vi.fn()
    const open = vi.fn()
    const copy = vi.fn()
    const model = appMenuModel(
      [
        { label: 'File', submenu: [{ label: 'Save', accelerator: 'CmdOrCtrl+S', click: save }, { type: 'separator' }, { label: 'Recent', enabled: false, submenu: [{ label: 'A', sublabel: 'C:\a', click: open }] }] },
        { label: 'Edit', submenu: [{ role: 'copy' }] }
      ],
      '',
      { copy: { label: 'Copy', key: 'Ctrl+C', run: copy } },
      actions
    )
    expect(model[0]!.submenu).toEqual([
      { id: '0.0', label: 'Save', enabled: true, accelerator: 'Ctrl+S' },
      { id: '0.1', label: '', separator: true },
      { id: '0.2', label: 'Recent', enabled: false, submenu: [{ id: '0.2.0', label: 'A', enabled: true, sublabel: 'C:\a' }] }
    ])
    expect(model[1]!.submenu).toEqual([{ id: '1.0', label: 'Copy', enabled: true, accelerator: 'Ctrl+C' }])
    actions.get('0.0')!()
    actions.get('0.2.0')!()
    actions.get('1.0')!()
    expect([save, open, copy].map((f) => f.mock.calls.length)).toEqual([1, 1, 1])
    expect([...actions.keys()].sort()).toEqual(['0.0', '0.2.0', '1.0'])
  })
})
