import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { layoutPanelIds, validateLayout } from './layout'
import { panelIds, panelRegistry } from './panelRegistry'
import { WORKSPACE_IDS, WORKSPACES } from './workspaces'

describe('panel registry', () => {
  it('every entry has a title, a component and sane sizes', () => {
    for (const [id, d] of Object.entries(panelRegistry)) {
      expect(d.title, id).not.toBe('')
      expect(typeof d.component, id).toBe('function')
      expect(d.defaultSize.width).toBeGreaterThanOrEqual(d.minSize.width)
      expect(d.defaultSize.height).toBeGreaterThanOrEqual(d.minSize.height)
    }
  })

  it('the three modes are valid and together show every registered panel', () => {
    expect(WORKSPACE_IDS).toEqual(['layout', 'behaviour', 'localization'])
    const seen = new Set<string>()
    for (const id of WORKSPACE_IDS) {
      const ids = layoutPanelIds(WORKSPACES[id].layout)
      expect(validateLayout(WORKSPACES[id].layout, panelIds), id).toEqual([])
      expect(new Set(ids).size, id).toBe(ids.length)
      ids.forEach((p) => seen.add(p))
    }
    expect([...seen].sort()).toEqual([...panelIds].sort())
  })

  it('each mode shows what its job needs: the graph only in Behaviour, the string table only in Localization', () => {
    const has = (id: (typeof WORKSPACE_IDS)[number], p: string): boolean => layoutPanelIds(WORKSPACES[id].layout).includes(p)
    expect(WORKSPACE_IDS.filter((i) => has(i, 'graph'))).toEqual(['behaviour'])
    expect(WORKSPACE_IDS.filter((i) => has(i, 'localization'))).toEqual(['localization'])
    expect(WORKSPACE_IDS.every((i) => has(i, 'preview') && has(i, 'inspector') && has(i, 'lintBudget'))).toBe(true)
  })

  it('panels are independent: no panel imports another panel or the workspace layer (only the Panel chrome, hooks, stores, models, preview pieces, ui, strings, shared)', () => {
    const dir = join(__dirname, '../panels')
    const files = readdirSync(dir).filter((f) => f.endsWith('Panel.tsx') && f !== 'Panel.tsx')
    expect(files.length).toBe(panelIds.length)
    for (const f of files) {
      const imports = [...readFileSync(join(dir, f), 'utf8').matchAll(/from '(\.[^']*)'/g)].map((m) => m[1]!)
      expect(imports.filter((i) => /^\.\/\w+Panel$/.test(i)), f).toEqual([])
      expect(imports.filter((i) => /\/workspace\//.test(i)), f).toEqual([])
    }
  })
})
