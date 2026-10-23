import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sha256 } from '../vanilla/bsa'
import { MANIFEST_NAME, readManifest, staleFiles, writeDeploy, type Manifest } from './write'

const f = (s: string, swf = 'hud') => ({ data: Buffer.from(s), swf })
const tmp = (): string => mkdtempSync(join(tmpdir(), 'inkwell-dep-'))
const man = (files: Record<string, string>, swf = 'hud'): Manifest => ({ version: 1, modId: 'M', deployedAt: 'x', files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, { sha256: v, swf }])) })

describe('staleFiles', () => {
  it('lists old files no longer produced; respects scope', () => {
    const old: Manifest = { version: 1, modId: 'M', deployedAt: '', files: { 'a.swf': { sha256: '1', swf: 'a' }, 'b.swf': { sha256: '2', swf: 'b' }, 'c.swf': { sha256: '3', swf: 'b' } } }
    expect(staleFiles(old, ['A.SWF'])).toEqual(['b.swf', 'c.swf'])
    expect(staleFiles(old, ['b.swf'], new Set(['b']))).toEqual(['c.swf'])
    expect(staleFiles(undefined, ['x'])).toEqual([])
  })
})

describe('writeDeploy', () => {
  it('writes files and a manifest with hashes; no temp files remain', async () => {
    const root = join(tmp(), 'mod')
    const o = await writeDeploy({ root, modId: 'M', files: new Map([['Interface/exported/widgets/M/Hud.swf', f('swf-bytes')], ['M.esp', f('esp')]]) })
    expect(o.written).toHaveLength(2)
    expect(readFileSync(join(root, 'Interface', 'exported', 'widgets', 'M', 'Hud.swf'), 'utf8')).toBe('swf-bytes')
    const m = await readManifest(root)
    expect(m?.files['M.esp']).toEqual({ sha256: sha256(Buffer.from('esp')), swf: 'hud' })
    expect(readdirSync(root).filter((n) => n.endsWith('.inkwell-tmp'))).toEqual([])
  })

  it('a second deploy skips identical files and removes files it wrote earlier that are no longer produced, plus emptied folders', async () => {
    const root = join(tmp(), 'mod')
    await writeDeploy({ root, modId: 'M', files: new Map([['Interface/old/gone.swf', f('1')], ['keep.txt', f('k')]]) })
    const o = await writeDeploy({ root, modId: 'M', files: new Map([['keep.txt', f('k')], ['new.txt', f('n')]]) })
    expect(o).toMatchObject({ written: ['new.txt'], unchanged: ['keep.txt'], removed: ['Interface/old/gone.swf'], kept: [] })
    expect(existsSync(join(root, 'Interface'))).toBe(false)
    expect(Object.keys((await readManifest(root))!.files)).toEqual(['keep.txt', 'new.txt'])
  })

  it('never touches files it did not write, and keeps a stale file the user changed', async () => {
    const root = join(tmp(), 'mod')
    mkdirSync(join(root, 'Meshes'), { recursive: true })
    writeFileSync(join(root, 'Meshes', 'theirs.nif'), 'not ours')
    writeFileSync(join(root, 'readme.txt'), 'not ours either')
    await writeDeploy({ root, modId: 'M', files: new Map([['a.swf', f('1')], ['b.swf', f('2')]]) })
    writeFileSync(join(root, 'b.swf'), 'edited by hand')
    const o = await writeDeploy({ root, modId: 'M', files: new Map() })
    expect(o.removed).toEqual(['a.swf'])
    expect(o.kept).toEqual(['b.swf'])
    expect(readFileSync(join(root, 'b.swf'), 'utf8')).toBe('edited by hand')
    expect(readFileSync(join(root, 'Meshes', 'theirs.nif'), 'utf8')).toBe('not ours')
    expect(readFileSync(join(root, 'readme.txt'), 'utf8')).toBe('not ours either')
    expect(Object.keys((await readManifest(root))!.files)).toEqual(['b.swf']) // still tracked
  })

  it('a tampered manifest cannot delete outside the mod folder', async () => {
    const parent = tmp()
    const root = join(parent, 'mod')
    mkdirSync(root)
    writeFileSync(join(parent, 'victim.txt'), 'precious')
    writeFileSync(join(root, MANIFEST_NAME), JSON.stringify(man({ '../victim.txt': sha256(Buffer.from('precious')), 'C:/Windows/x': '0' })))
    const o = await writeDeploy({ root, modId: 'M', files: new Map([['ok.txt', f('1')]]) })
    expect(o.removed).toEqual([])
    expect(o.kept).toHaveLength(2)
    expect(readFileSync(join(parent, 'victim.txt'), 'utf8')).toBe('precious')
  })

  it('an unsafe new path aborts before anything is written', async () => {
    const root = join(tmp(), 'mod')
    await expect(writeDeploy({ root, modId: 'M', files: new Map([['fine.txt', f('1')], ['../escape.txt', f('2')]]) })).rejects.toThrow(/unsafe|leave/)
    expect(existsSync(join(root, 'fine.txt'))).toBe(false)
  })

  it('a scoped (active SWF) deploy leaves other SWFs files and manifest entries alone', async () => {
    const root = join(tmp(), 'mod')
    await writeDeploy({ root, modId: 'M', files: new Map([['a.swf', f('1', 'a')], ['b.swf', f('2', 'b')]]) })
    const o = await writeDeploy({ root, modId: 'M', files: new Map([['a2.swf', f('3', 'a')]]), scope: new Set(['a']) })
    expect(o.removed).toEqual(['a.swf'])
    expect(existsSync(join(root, 'b.swf'))).toBe(true)
    expect(Object.keys((await readManifest(root))!.files)).toEqual(['a2.swf', 'b.swf'])
  })
})
