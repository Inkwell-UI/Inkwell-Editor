import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { layoutPanelIds, validateLayout, type LayoutNode } from './layout'
import { panelIds, panelRegistry } from './panelRegistry'
import { BEHAVIOUR_PREVIEW_HEIGHT, WORKSPACE_IDS, WORKSPACES } from './workspaces'

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

  it('the Menu settings panel is registered, a tab in the left group of Layout and Behaviour only (the target pill opens the same form in a dialog)', () => {
    expect(panelRegistry.menuSettings.title).toBe('Menu')
    expect(typeof panelRegistry.menuSettings.useTabInfo).toBe('function')
    const left = (id: (typeof WORKSPACE_IDS)[number]): string[] => {
      const row = (WORKSPACES[id].layout as { children: LayoutNode[] }).children[0] as { children: { kind: string; tabs?: { panel: string }[] }[] }
      return row.children[0]!.tabs!.map((t) => t.panel)
    }
    expect(left('layout')).toEqual(['navigator', 'assets', 'menuSettings'])
    expect(left('behaviour')).toEqual(['navigator', 'contracts', 'variables', 'menuSettings'])
    expect(layoutPanelIds(WORKSPACES.localization.layout)).not.toContain('menuSettings')
  })

  it('Behaviour: the graph owns the centre column, the right column is [fixed preview, inspector] with no splitter between', () => {
    const main = (WORKSPACES.behaviour.layout as { children: LayoutNode[] }).children[0] as { children: LayoutNode[] }
    expect(main.children).toHaveLength(3)
    expect(main.children[1]).toMatchObject({ kind: 'panel', panel: 'graph' })
    const right = main.children[2] as { kind: string; direction: string; children: LayoutNode[] }
    expect(right).toMatchObject({ kind: 'split', direction: 'column' })
    expect(right.children[0]).toMatchObject({ kind: 'panel', panel: 'preview', fixed: BEHAVIOUR_PREVIEW_HEIGHT })
    expect(right.children[1]).toMatchObject({ kind: 'panel', panel: 'inspector' })
    expect(JSON.stringify([WORKSPACES.layout.layout, WORKSPACES.localization.layout])).not.toContain('"fixed"')
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
