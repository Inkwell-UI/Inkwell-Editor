import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultLayout, layoutPanelIds, validateLayout } from './layout'
import { panelIds, panelRegistry } from './panelRegistry'

describe('panel registry', () => {
  it('every entry has a title, a component and sane sizes', () => {
    for (const [id, d] of Object.entries(panelRegistry)) {
      expect(d.title, id).not.toBe('')
      expect(typeof d.component, id).toBe('function')
      expect(d.defaultSize.width).toBeGreaterThanOrEqual(d.minSize.width)
      expect(d.defaultSize.height).toBeGreaterThanOrEqual(d.minSize.height)
    }
  })

  it('the default layout is valid and shows every registered panel exactly once', () => {
    expect(validateLayout(defaultLayout, panelIds)).toEqual([])
    expect(layoutPanelIds(defaultLayout).sort()).toEqual([...panelIds].sort())
  })

  it('panels are independent: no panel imports another panel (only the Panel chrome, hooks, preview pieces, strings, shared)', () => {
    const dir = join(__dirname, '../panels')
    const files = readdirSync(dir).filter((f) => f.endsWith('Panel.tsx') && f !== 'Panel.tsx')
    expect(files.length).toBe(panelIds.length)
    for (const f of files) {
      const imports = [...readFileSync(join(dir, f), 'utf8').matchAll(/from '(\.[^']*)'/g)].map((m) => m[1]!)
      expect(imports.filter((i) => /^\.\/\w+Panel$/.test(i)), f).toEqual([])
      expect(imports.filter((i) => i.includes('workspace')), f).toEqual([])
    }
  })
})
