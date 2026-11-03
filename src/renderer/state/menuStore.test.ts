import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MenuSettings } from '@inkwell-ui/spec'
import { defaultMenuSettings } from '../../shared/menu'
import { editMenu, getMenuStore, resetMenus, setMenuSaver } from './menuStore'
import { redoSwf, resetSwfHistory, undoSwf } from './swfHistory'

describe('menuStore', () => {
  const saved: MenuSettings[] = []
  beforeEach(() => {
    resetMenus()
    resetSwfHistory()
    saved.length = 0
    setMenuSaver(async (_n, d) => (saved.push(d), { ok: true }))
  })
  it('an edit, undo and redo are all saved and ordered by the SWF history', async () => {
    const base = defaultMenuSettings()
    const store = getMenuStore('s1', 'Menu', base)
    const next = MenuSettings.parse({ ...base, flags: { ...base.flags, blur: !base.flags.blur } })
    await editMenu('s1', next)
    expect(store.getState().doc).toBe(next)
    undoSwf('s1')
    expect(store.getState().doc).toBe(base)
    redoSwf('s1')
    expect(store.getState().doc).toBe(next)
    await vi.waitFor(() => expect(saved).toEqual([next, base, next]))
  })
})
