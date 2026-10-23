import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sha256 } from './bsa'
import { buildBsa } from './bsa.testutil'
import { buildVanillaCache, isInside, isUnmodifiedVanilla, loadVanillaHashes, vanillaCacheStatus } from './cache'

const swfA = Buffer.from('FWS-vanilla-inventory '.repeat(50))
const swfB = Buffer.from('CWS-vanilla-hud')

describe('vanilla cache', () => {
  const work = mkdtempSync(join(tmpdir(), 'inkwell-vc-'))
  const bsaPath = join(work, 'Skyrim - Interface.bsa')
  writeFileSync(bsaPath, buildBsa([
    { folder: 'interface', name: 'inventorymenu.swf', data: swfA, compress: true },
    { folder: 'interface', name: 'hudmenu.swf', data: swfB },
    { folder: 'interface', name: 'fontconfig.txt', data: Buffer.from('not a swf') }
  ]))
  const root = join(work, 'userdata', 'vanilla-cache')

  it('reports not built, builds under <root>/<archiveHash>/, then reports built', async () => {
    expect(await vanillaCacheStatus({ bsaPath, cacheRoot: root })).toMatchObject({ built: false })
    const r = await buildVanillaCache({ bsaPath, cacheRoot: root })
    expect(r.entries).toBe(2)
    expect(r.dir).toBe(join(root, r.archiveHash))
    expect(readFileSync(join(r.dir, 'interface', 'inventorymenu.swf')).equals(swfA)).toBe(true)
    expect(existsSync(join(r.dir, 'interface', 'fontconfig.txt'))).toBe(false) // SWFs only
    const s = await vanillaCacheStatus({ bsaPath, cacheRoot: root })
    expect(s).toMatchObject({ built: true, entries: 2, bytes: swfA.length + swfB.length, dir: r.dir })
  })

  it('isUnmodifiedVanilla: exact vanilla bytes yes, any change no, empty index never matches', async () => {
    const hashes = await loadVanillaHashes(root)
    expect(hashes.size).toBe(2)
    expect(isUnmodifiedVanilla(swfA, hashes)).toBe(true)
    expect(isUnmodifiedVanilla(Buffer.concat([swfB, Buffer.from([0])]), hashes)).toBe(false)
    expect(isUnmodifiedVanilla(swfB, new Set())).toBe(false)
    expect(hashes.has(sha256(swfB))).toBe(true)
  })

  it('a cache folder without index.json is not built', async () => {
    expect(await loadVanillaHashes(join(work, 'nothing'))).toEqual(new Set())
    expect(await vanillaCacheStatus({ cacheRoot: join(work, 'nothing') })).toEqual({ built: false })
  })

  it('isInside is case-insensitive and respects folder boundaries', () => {
    expect(isInside('C:\\Proj\\build\\x', 'c:\\proj')).toBe(true)
    expect(isInside('C:\\Project2', 'C:\\Proj')).toBe(false)
    expect(isInside('C:\\Proj', 'C:\\Proj')).toBe(true)
  })
})
