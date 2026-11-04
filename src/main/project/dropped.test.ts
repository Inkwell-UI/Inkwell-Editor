import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { droppedProjectDir } from './dropped'

describe('droppedProjectDir', () => {
  it('accepts a directory with project.json (resolved), refuses everything else', async () => {
    const d = mkdtempSync(join(tmpdir(), 'inkwell-drop-'))
    const proj = join(d, 'p')
    mkdirSync(proj)
    writeFileSync(join(proj, 'project.json'), '{}')
    mkdirSync(join(d, 'empty'))
    writeFileSync(join(d, 'file.txt'), 'x')
    expect(await droppedProjectDir(join(proj, '..', 'p'))).toBe(resolve(proj))
    expect(await droppedProjectDir(join(d, 'empty'))).toBeUndefined()
    expect(await droppedProjectDir(join(d, 'file.txt'))).toBeUndefined()
    expect(await droppedProjectDir(join(proj, 'project.json'))).toBeUndefined()
    expect(await droppedProjectDir(join(d, 'missing'))).toBeUndefined()
    expect(await droppedProjectDir('p')).toBeUndefined() // relative
    expect(await droppedProjectDir(42)).toBeUndefined()
    expect(await droppedProjectDir('')).toBeUndefined()
  })
})
