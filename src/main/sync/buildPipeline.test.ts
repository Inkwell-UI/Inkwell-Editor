import { copyFile, cp, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FfdecJob } from '../build/ffdecWrapper'
import { createAssetStore } from '../images/assets'
import { syntheticPng } from '../images/synthetic'
import { Swf } from '@inkwell-ui/spec'
import { frame, rectShape, swf, textNode } from '../swf/ir.testutil'
import { parseSwf } from '../swf/swfReader.testutil'
import { TAG } from '../swf/tags'
import type { PreviewFontSet } from '../previewFonts'
import { loadProject } from '../project'
import { readSnapshot } from '../project/snapshot'
import { createBuildPipeline } from './buildPipeline'

const ir = () => swf([frame('f', ['s', 't']), rectShape('s'), textNode('t', { verticalAlign: 'center' })])
const base = { javaPath: 'java', ffdecDir: '', jarPath: '' }

async function run(failPreview: boolean, previewFonts?: PreviewFontSet) {
  const buildDir = await mkdtemp(join(tmpdir(), 'inkwell-pipe-'))
  const jobs: FfdecJob[] = []
  const ffdec = {
    build: async (job: FfdecJob) => {
      jobs.push(job)
      if (failPreview && job.out.endsWith('.preview.swf')) return { ok: false, error: 'boom', ms: 0, wallMs: 0 }
      await copyFile(job.base, job.out) // stands in for FFDec: the skeleton is the output
      return { ok: true, ms: 0, wallMs: 0 }
    }
  }
  const got: { timing?: { stages: Record<string, number>; total: number }; preview?: Record<string, any> } = {}
  const p = createBuildPipeline({ ...base, buildDir, ffdec, onBuild: (_p, timing) => (got.timing = timing), onPreview: (pv) => (got.preview = pv), ...(previewFonts ? { previewFonts } : {}) })
  const result = await p.onChange('test', ir(), 'hud')
  return { buildDir, jobs, result, ...got }
}

describe('build pipeline: preview', () => {
  it('builds the game SWF, then the preview SWF; stages are timed separately', async () => {
    const r = await run(false)
    expect(r.jobs.map((j) => basename(j.out))).toEqual(['hud.swf', 'hud.preview.swf'])
    expect(Object.keys(r.timing!.stages)).toContain('preview-build')
    expect(r.timing!.stages['preview-build']).toBeGreaterThan(0)
    expect(r.preview).toMatchObject({ swfId: 'test', name: 'hud', stage: { width: 1920, height: 1080 }, notes: { textExtensions: 1, textNodes: 1, approximated: [] } })
    const bytes = Buffer.from(r.preview!['bytes'])
    expect(bytes).toEqual(await readFile(join(r.buildDir, 'hud.preview.swf')))
    expect(bytes.includes(Buffer.from('gfxfontlib.swf'))).toBe(false) // preview: no ImportAssets2
    expect((await readFile(join(r.buildDir, 'hud.swf'))).includes(Buffer.from('gfxfontlib.swf'))).toBe(true)
  })

  it('preview text names the resolved font; font bytes stay in main (the SWF and notes carry only the name and a label)', async () => {
    const secret = Buffer.from('SECRET-TTF-BYTES')
    const fonts: PreviewFontSet = {
      fonts: [],
      nameFor: (a) => (a === '$EverywhereMediumFont' ? 'Test Face' : '_sans'),
      bytesFor: () => undefined,
      approximated: () => ['Everywhere Medium']
    }
    const r = await run(false, { ...fonts, fonts: [{ face: { aliases: [], label: 'x', bundled: 'x' }, source: 'bundled', family: 'Test Face', bytes: secret }] })
    const bytes = Buffer.from(r.preview!['bytes'])
    expect(bytes.includes(Buffer.from('Test Face'))).toBe(true)
    expect(bytes.includes(secret)).toBe(false)
    expect(r.preview!['notes']).toEqual({ textExtensions: 1, textNodes: 1, approximated: ['Everywhere Medium'] })
  })

  it('a failing preview does not fail the build; the error goes to the preview', async () => {
    const r = await run(true)
    expect(r.result.issues).toEqual([])
    expect(r.preview!['error']).toMatch(/boom/)
    expect(r.preview!['bytes']).toBeUndefined()
    expect(r.timing!.stages).toHaveProperty('preview-build')
  })
})

describe('build pipeline: overlay written by the editor UI', () => {
  it('re-reads overlay.json from disk on every build, uses its instance names, and never writes back a stale overlay', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inkwell-pipe-proj-'))
    await cp(resolve(__dirname, '../../../samples/hud-minimal'), dir, { recursive: true, filter: (p) => !/[\/]build([\/]|$)/.test(p) && !/swfs[\/](root|root2)/.test(p) })
    const ffdec = { build: async (job: FfdecJob) => (await copyFile(job.base, job.out), { ok: true, ms: 0, wallMs: 0 }) }
    const p = createBuildPipeline({ ...base, projectDir: dir, buildDir: join(dir, 'build'), ffdec })
    const hud = ir()
    await p.onChange('hud', { ...hud, id: 'hud', name: 'HUD Minimal' }, 'hud') // caches the project (with the sample's overlay)
    const file = join(dir, 'swfs/hud/overlay.json')
    const saved = JSON.parse(await readFile(file, 'utf8'))
    saved.nodes.t = { instanceName: 'DamageVal_Txt', future: 1 } // what the Inspector would save
    await writeFile(file, JSON.stringify(saved))
    await p.onChange('hud', { ...hud, id: 'hud', name: 'HUD Minimal' }, 'hud')
    const after = JSON.parse(await readFile(file, 'utf8'))
    expect(after.nodes.t).toEqual({ future: 1, instanceName: 'DamageVal_Txt' }) // not overwritten by the cached, older overlay
  })
})

describe('build pipeline: images', () => {
  it('reads imageMode from project.json: dds -> the game SWF loads the image, the preview embeds it and its notes say so', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inkwell-pipe-img-'))
    await cp(resolve(__dirname, '../../../samples/hud-minimal'), dir, { recursive: true, filter: (p) => !/[\/]build([\/]|$)/.test(p) && !/swfs[\/](root|root2)/.test(p) })
    const meta = JSON.parse(await readFile(join(dir, 'project.json'), 'utf8'))
    await writeFile(join(dir, 'project.json'), JSON.stringify({ ...meta, imageMode: 'dds' }))
    const img = syntheticPng(16, 16)
    const assets = createAssetStore(dir)
    await assets.put(img.hash, img.png)
    const ffdec = { build: async (job: FfdecJob) => (await copyFile(job.base, job.out), { ok: true, ms: 0, wallMs: 0 }) }
    let preview: Record<string, any> | undefined
    const p = createBuildPipeline({ ...base, projectDir: dir, buildDir: join(dir, 'build'), ffdec, assets, onPreview: (pv) => (preview = pv) })
    const node = { ...rectShape('i'), parent: 'f', type: 'image', asset: img.hash, scaleMode: 'fit' } as unknown as Parameters<typeof swf>[0][number]
    const r = await p.onChange('hud', { ...swf([frame('f', ['i']), node]), id: 'hud', name: 'HUD Minimal' }, 'hud')
    expect(r.issues).toEqual([])
    const bitmaps = (b: Buffer) => parseSwf(b).tags.filter((t) => t.code === TAG.DefineBitsLossless2).length
    expect(bitmaps(await readFile(join(dir, 'build', 'hud.swf')))).toBe(0)
    expect(bitmaps(Buffer.from(preview!['bytes']))).toBe(1)
    expect(preview!['notes']).toMatchObject({ ddsImages: 1 })
  })
})

describe('build pipeline: offline (no sync server) and figma/snapshot.json', () => {
  it('opens a project and builds every SWF from ir.json + assets alone; the first build writes the snapshot, the next ones leave it alone', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inkwell-offline-'))
    await cp(resolve(__dirname, '../../../samples/hud-widget'), dir, { recursive: true })
    const ffdec = { build: async (job: FfdecJob) => (await copyFile(job.base, job.out), { ok: true, ms: 0, wallMs: 0 }) }
    const snaps: unknown[] = []
    const p = createBuildPipeline({ ...base, projectDir: dir, buildDir: join(dir, 'build'), ffdec, assets: createAssetStore(dir), onSnapshot: (s) => snaps.push(s) })
    const project = await loadProject(dir) // what session.open does; no server, no plugin
    const builds = []
    for (const [name, s] of Object.entries(project.swfs)) {
      const ir = Swf.parse(s.ir)
      builds.push(await p.onChange(ir.id, ir, name))
      expect((await stat(join(dir, 'build', `${name}.swf`))).size).toBeGreaterThan(0)
    }
    expect(builds.flatMap((b) => b.issues ?? []).filter((i) => (i as { severity?: string }).severity === 'error')).toEqual([])
    const first = await readFile(join(dir, 'figma', 'snapshot.json'), 'utf8')
    const snap = (await readSnapshot(dir)).snapshot!
    expect(snap.swfs['hud']).toMatchObject({ frameId: Swf.parse(project.swfs['hud']!.ir).id })
    expect(snap).not.toHaveProperty('source') // no plugin connected
    // Build All again, offline: same bytes, same time
    const ir = Swf.parse(project.swfs['hud']!.ir)
    await p.onChange(ir.id, ir, 'hud')
    expect(await readFile(join(dir, 'figma', 'snapshot.json'), 'utf8')).toBe(first)
    expect(snaps.length).toBe(2)
  })

  it('records the plugin of the last hello', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inkwell-offline-'))
    await cp(resolve(__dirname, '../../../samples/hud-widget'), dir, { recursive: true })
    const ffdec = { build: async (job: FfdecJob) => (await copyFile(job.base, job.out), { ok: true, ms: 0, wallMs: 0 }) }
    const p = createBuildPipeline({ ...base, projectDir: dir, buildDir: join(dir, 'build'), ffdec, snapshotSource: () => ({ pluginVersion: '0.9.0', fileKey: 'K' }) })
    const ir = Swf.parse((await loadProject(dir)).swfs['hud']!.ir)
    await p.onChange(ir.id, ir, 'hud')
    expect((await readSnapshot(dir)).snapshot?.source).toEqual({ pluginVersion: '0.9.0', fileKey: 'K' })
  })
})
