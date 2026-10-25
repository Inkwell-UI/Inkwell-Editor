import { SPEC_VERSION } from '@inkwell-ui/spec'
import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadProject } from './index'
import { copyExample, createProject, PROJECT_GITIGNORE } from './lifecycle'
import { writeOverlay } from './overlayFile'
import { addRecent, loadRecent, saveRecent } from './recent'
import { writeProjectSetting } from './settings'

const sample = resolve(__dirname, '../../../samples/hud-minimal')
const tmp = (): Promise<string> => mkdtemp(join(tmpdir(), 'inkwell-ui-'))

describe('new and example projects', () => {
  it('creates an empty project that loads, with the folder name as mod id', async () => {
    const dir = join(await tmp(), 'My Mod')
    await createProject(dir)
    const p = await loadProject(dir)
    expect(p.meta).toMatchObject({ name: 'My Mod', modId: 'My_Mod', version: '0.1.0' })
    expect(p.swfs).toEqual({})
    expect(await readFile(join(dir, '.gitignore'), 'utf8')).toBe('build/\ndist/\n') // build output and Package Mod zips are never committed
  })
  it('refuses a folder that already has files', async () => {
    const dir = await tmp()
    await writeFile(join(dir, 'x.txt'), 'x')
    await expect(createProject(dir)).rejects.toThrow(/not empty/)
    await expect(copyExample(sample, dir)).rejects.toThrow(/not empty/)
  })
  it('copies the sample without its build output', async () => {
    const dir = join(await tmp(), 'ex')
    await copyExample(sample, dir)
    expect(await readdir(dir)).not.toContain('build')
    expect(await readFile(join(dir, '.gitignore'), 'utf8')).toBe(PROJECT_GITIGNORE)
    expect((await loadProject(dir)).meta.name).toBe('HUD Minimal')
  })
})

describe('overlay.json writes', () => {
  it('writes a validated overlay, keeping unknown keys, and refuses bad instance names and paths', async () => {
    const dir = await tmp()
    expect(await writeOverlay(dir, 'Menu', { nodes: { a: { instanceName: 'Ok', future: [1] } }, extra: true })).toEqual({ ok: true })
    const saved = JSON.parse(await readFile(join(dir, 'swfs/Menu/overlay.json'), 'utf8'))
    expect(saved).toEqual({ extra: true, nodes: { a: { future: [1], instanceName: 'Ok' } }, specVersion: SPEC_VERSION })
    expect((await writeOverlay(dir, 'Menu', { nodes: { a: { instanceName: 'not ok' } } })).ok).toBe(false)
    expect((await writeOverlay(dir, '../evil', { nodes: {} })).ok).toBe(false)
    expect((await writeOverlay(dir, 'Menu', 'x')).ok).toBe(false)
  })
})

describe('project settings', () => {
  it('sets strictMode and keeps unknown keys', async () => {
    const dir = await tmp()
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'project.json'), JSON.stringify({ name: 'n', modId: 'm', version: '1', deploy: { preset: 'mo2', path: 'p' }, 'x-unknown': 1 }))
    await writeProjectSetting(dir, 'strictMode', true)
    expect(JSON.parse(await readFile(join(dir, 'project.json'), 'utf8'))).toMatchObject({ strictMode: true, 'x-unknown': 1, name: 'n' })
  })
})

describe('recent projects', () => {
  const r = (dir: string, t = '2026-01-01') => ({ dir, name: dir, openedAt: t })
  it('newest first, one per folder (case-insensitive, trailing slash), capped', () => {
    let l = addRecent([], r('C:\\A'))
    l = addRecent(l, r('C:\\B'))
    l = addRecent(l, r('c:\\a\\'))
    expect(l.map((x) => x.dir)).toEqual(['c:\\a\\', 'C:\\B'])
    for (let i = 0; i < 20; i++) l = addRecent(l, r(`D:\\${i}`))
    expect(l).toHaveLength(10)
  })
  it('round-trips through a file; a damaged file is an empty list', async () => {
    const f = join(await tmp(), 'recent.json')
    await saveRecent(f, [r('X')])
    expect(await loadRecent(f)).toEqual([r('X')])
    await writeFile(f, '{not json')
    expect(await loadRecent(f)).toEqual([])
    await writeFile(f, JSON.stringify([{ dir: 1 }, r('Y')]))
    expect(await loadRecent(f)).toEqual([r('Y')])
    expect(await loadRecent(join(await tmp(), 'missing.json'))).toEqual([])
  })
})
