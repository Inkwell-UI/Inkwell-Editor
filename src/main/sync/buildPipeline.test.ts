import { copyFile, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FfdecJob } from '../build/ffdecWrapper'
import { frame, rectShape, swf, textNode } from '../swf/ir.testutil'
import type { PreviewFontSet } from '../previewFonts'
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
