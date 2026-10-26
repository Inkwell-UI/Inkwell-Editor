// swfs/<name>/menu.json: stable bytes, golden round trip, unknown keys kept, a broken file is reported and never overwritten (S9).
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { MenuSettings } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { loadProject, saveProject } from './index'
import { menuText, readMenuSettings, writeMenuSettings } from './menuFile'

const sample = resolve(__dirname, '../../../samples/menu-slice')
const scratch = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'inkwell-menu-file-'))
  cpSync(sample, d, { recursive: true })
  return d
}

describe('menu.json', () => {
  it('golden bytes: sorted keys, 2-space indent, trailing newline', () => {
    const m = MenuSettings.parse({ specVersion: 6, triggers: { hotkey: 37, modEvent: 'M_Open' }, depth: 6, flags: { modal: true }, userDefaults: { uiScale: 1.5 } })
    expect(menuText(m)).toBe(`{
  "depth": 6,
  "flags": {
    "closeOnEscape": true,
    "cursor": false,
    "modal": true,
    "pausesGame": false
  },
  "specVersion": 6,
  "triggers": {
    "hotkey": 37,
    "modEvent": "M_Open",
    "papyrus": true
  },
  "userDefaults": {
    "uiScale": 1.5
  }
}
`)
  })

  it('round trip through the IPC writer and the reader gives the same bytes; unknown keys survive at every level', async () => {
    const dir = scratch()
    const doc = { specVersion: 6, futureKey: { a: [1, 2] }, flags: { modal: true, futureFlag: 1 }, triggers: { hotkey: 37 }, userDefaults: { uiScale: 1.25, futureDefault: 'x' }, depth: 5 }
    const w = await writeMenuSettings(dir, 'menu', doc)
    expect(w.ok).toBe(true)
    const first = readFileSync(join(dir, 'swfs', 'menu', 'menu.json'), 'utf8')
    const r = await readMenuSettings(dir, 'menu')
    expect(r.settings).toMatchObject({ futureKey: { a: [1, 2] }, flags: { futureFlag: 1 }, userDefaults: { futureDefault: 'x' } })
    expect((await writeMenuSettings(dir, 'menu', r.settings)).ok).toBe(true)
    expect(readFileSync(join(dir, 'swfs', 'menu', 'menu.json'), 'utf8')).toBe(first)
  })

  it('the sample round-trips byte for byte (it is committed in the stable form)', async () => {
    const dir = scratch()
    const before = readFileSync(join(dir, 'swfs', 'menu', 'menu.json'), 'utf8')
    const r = await readMenuSettings(dir, 'menu')
    expect(menuText(r.settings!)).toBe(before)
  })

  it('rejects an invalid document without writing; a missing file is not an error', async () => {
    const dir = scratch()
    const before = readFileSync(join(dir, 'swfs', 'menu', 'menu.json'), 'utf8')
    expect(await writeMenuSettings(dir, 'menu', { specVersion: 6, triggers: { hotkey: 1 } })).toMatchObject({ ok: false, error: expect.stringContaining('hotkey') })
    expect(await writeMenuSettings(dir, '../x', { specVersion: 6 })).toMatchObject({ ok: false })
    expect(readFileSync(join(dir, 'swfs', 'menu', 'menu.json'), 'utf8')).toBe(before)
    expect(await readMenuSettings(dir, 'nothing-here')).toEqual({})
  })

  it('loadProject carries it; a project save writes it back unchanged, and never overwrites a file it could not read', async () => {
    const dir = scratch()
    const p = await loadProject(dir)
    expect(p.swfs['menu']!.menu).toMatchObject({ triggers: { hotkey: 66, modEvent: 'InkwellMenuTest_Open' } })
    const bytes = readFileSync(join(dir, 'swfs', 'menu', 'menu.json'), 'utf8')
    await saveProject(dir, p)
    expect(readFileSync(join(dir, 'swfs', 'menu', 'menu.json'), 'utf8')).toBe(bytes)
    writeFileSync(join(dir, 'swfs', 'menu', 'menu.json'), '{ not json')
    const broken = await loadProject(dir)
    expect(broken.swfs['menu']!.menu).toBeUndefined()
    expect(broken.swfs['menu']!.menuError).toContain('menu.json')
    await saveProject(dir, broken)
    expect(readFileSync(join(dir, 'swfs', 'menu', 'menu.json'), 'utf8')).toBe('{ not json')
    writeFileSync(join(dir, 'swfs', 'menu', 'menu.json'), JSON.stringify({ specVersion: 6, depth: 99 }))
    expect((await readMenuSettings(dir, 'menu')).error).toContain('depth')
  })

  it('golden round trip of samples/menu-slice: load then save gives every file back byte for byte', async () => {
    const src = scratch()
    const out = mkdtempSync(join(tmpdir(), 'inkwell-menu-out-'))
    await saveProject(out, await loadProject(src))
    for (const f of ['project.json', 'swfs/menu/ir.json', 'swfs/menu/overlay.json', 'swfs/menu/menu.json', 'swfs/menu/graphs/main.json']) expect(readFileSync(join(out, f), 'utf8'), f).toBe(readFileSync(join(src, f), 'utf8'))
  })

  it('a project without menu.json loads and saves without creating one', async () => {
    const dir = scratch()
    const p = await loadProject(dir)
    delete p.swfs['menu']!.menu
    const { rmSync } = await import('node:fs')
    rmSync(join(dir, 'swfs', 'menu', 'menu.json'))
    await saveProject(dir, p)
    expect(existsSync(join(dir, 'swfs', 'menu', 'menu.json'))).toBe(false)
  })
})
