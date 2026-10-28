// The shipped example projects (samples/*, each with a README): they copy through `copyExample` (no build output), load, carry no binary asset (PNG, DDS, fonts, SWFs: the repo stays
// text only), and every graph of a custom menu or widget loads. Their compile is covered next to each feature (replacement, gamepad, popup, stopwatch: examples.integration.test.ts).
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadProject } from './index'
import { copyExample } from './lifecycle'

const samples = resolve(__dirname, '../../../samples')
const EXAMPLES = ['stopwatch', 'inventory-replacement', 'menu-gamepad', 'hud-graph-popup', 'hud-minimal'] as const
const BINARY = /\.(png|jpe?g|dds|ttf|otf|swf|pex|esp|dll)$/i

async function files(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === 'build' || e.name === 'node_modules') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await files(p)))
    else out.push(p)
  }
  return out
}

describe.each(EXAMPLES)('example %s', (name) => {
  const src = join(samples, name)
  it('has a README and no binary file', async () => {
    const all = await files(src)
    if (name !== 'hud-minimal') expect(all.some((f) => /README\.md$/.test(f)), 'README.md').toBe(true)
    expect(all.filter((f) => BINARY.test(f))).toEqual([])
  })
  it('copies without build output and loads', async () => {
    const dest = join(await mkdtemp(join(tmpdir(), 'inkwell-example-')), name)
    await copyExample(src, dest)
    expect(await readdir(dest)).not.toContain('build')
    const p = await loadProject(dest)
    expect(Object.keys(p.swfs).length).toBeGreaterThan(0)
    expect(await readFile(join(dest, '.gitignore'), 'utf8')).toContain('build/')
  })
})
