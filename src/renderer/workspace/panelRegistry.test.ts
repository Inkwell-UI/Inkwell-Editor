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

  it('the three workspaces are valid and each shows every registered panel exactly once (only sizes and open tabs differ)', () => {
    expect(WORKSPACE_IDS).toEqual(['wire', 'verify', 'debug'])
    for (const id of WORKSPACE_IDS) {
      const layout = WORKSPACES[id].layout
      expect(validateLayout(layout, panelIds), id).toEqual([])
      expect(layoutPanelIds(layout).sort(), id).toEqual([...panelIds].sort())
    }
  })

  it('the workspaces differ in emphasis as UX 2.3 says', () => {
    const share = (id: 'wire' | 'verify' | 'debug', panel: string): number => {
      const find = (n: ReturnType<typeof JSON.parse>): number | undefined => (n.kind === 'panel' ? (n.panel === panel ? (n.size ?? 1) : undefined) : n.kind === 'tabs' ? undefined : n.children.map(find).find((x: number | undefined) => x !== undefined))
      return find(WORKSPACES[id].layout)!
    }
    expect(share('verify', 'preview')).toBeGreaterThan(share('verify', 'graph'))
    expect(share('wire', 'graph')).toBeGreaterThan(share('wire', 'preview'))
    expect(share('debug', 'graph')).toBeGreaterThan(share('debug', 'preview'))
    expect(share('verify', 'preview')).toBeGreaterThan(share('wire', 'preview'))
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
