import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FFDEC_PINNED } from '../../shared/ffdec'
import { resolveSettings } from '../settings'
import { checkJava, checkProjectIgnore, ffdecVersion, ignoresBuild, parseJavaVersion, type DoctorContext } from './checks'
import { runDoctor } from './index'

const appPath = resolve(__dirname, '../../..')
const ctx = (over: Partial<DoctorContext> = {}, env: NodeJS.ProcessEnv = {}): DoctorContext => ({
  settings: resolveSettings({}, env), appPath, userData: mkdtempSync(join(tmpdir(), 'inkwell-doc-')), pluginConnections: 0, ...over
})

describe('doctor pieces', () => {
  it('the pinned FFDec version equals the wrapper source', () => {
    const java = readFileSync(join(appPath, 'tools/ffdec-wrapper/src/com/inkwell/Wrapper.java'), 'utf8')
    expect(/PINNED = "([^"]+)"/.exec(java)?.[1]).toBe(FFDEC_PINNED)
  })
  it('parses java versions of both schemes', () => {
    expect(parseJavaVersion('openjdk version "1.8.0_504"')).toBe(8)
    expect(parseJavaVersion('openjdk version "17.0.2" 2022-01-18')).toBe(17)
    expect(parseJavaVersion('java version "21"')).toBe(21)
    expect(parseJavaVersion('garbage')).toBeUndefined()
  })
  it('java: pass on 8+, fail when too old, unrunnable or unreadable', async () => {
    expect((await checkJava(ctx({ exec: async () => 'openjdk version "1.8.0_504"' }))).status).toBe('pass')
    expect((await checkJava(ctx({ exec: async () => 'java version "1.7.0"' }))).status).toBe('fail')
    const bad = await checkJava(ctx({ exec: async () => Promise.reject(new Error('ENOENT')) }))
    expect(bad).toMatchObject({ status: 'fail', fix: { action: { kind: 'browse', setting: 'javaPath' } } })
    expect((await checkJava(ctx({ exec: async () => 'hello' }))).status).toBe('fail')
  })
  it('ignoresBuild accepts the usual spellings only', () => {
    for (const t of ['build', 'build/', '/build/', 'node_modules\nbuild/\n', 'build/*']) expect(ignoresBuild(t)).toBe(true)
    for (const t of ['', 'builds/', '# build/', 'src/build']) expect(ignoresBuild(t)).toBe(false)
  })
  it('project ignore check: skipped without project, warn without or with a wrong .gitignore, pass with build/', async () => {
    expect((await checkProjectIgnore(ctx())).status).toBe('skipped')
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-proj-'))
    expect((await checkProjectIgnore(ctx({ projectDir: dir }))).status).toBe('warn')
    writeFileSync(join(dir, '.gitignore'), 'out\n')
    expect((await checkProjectIgnore(ctx({ projectDir: dir }))).status).toBe('warn')
    writeFileSync(join(dir, '.gitignore'), 'out\nbuild/\n')
    expect((await checkProjectIgnore(ctx({ projectDir: dir }))).status).toBe('pass')
  })
  it('a vanilla cache folder inside the project fails the check', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-proj-'))
    writeFileSync(join(dir, '.gitignore'), 'build/\n')
    expect((await checkProjectIgnore(ctx({ projectDir: dir, userData: join(dir, 'ud') }))).status).toBe('fail')
  })
  it('reads the FFDec version from the jar when FFDec is installed', () => {
    const v = ffdecVersion(resolveSettings({}, {}).ffdecDir)
    if (v !== undefined) expect(v).toMatch(/^\d+\.\d+\.\d+/)
  })
})

describe('runDoctor', () => {
  it('never throws: with everything pointing nowhere every check still answers', async () => {
    const env = { INKWELL_FFDEC: 'Z:\\nope', INKWELL_JAVA: 'Z:\\nope\\java.exe', INKWELL_PAPYRUS: 'Z:\\nope\\p.exe', INKWELL_SKYRIM: 'Z:\\nope', INKWELL_FIGMA_MANIFEST: 'Z:\\nope\\m.json' }
    const r = await runDoctor(ctx({ exec: async () => Promise.reject(new Error('no')) }, env))
    expect(r.map((c) => c.id)).toEqual(['java', 'ffdec', 'wrapper', 'papyrus', 'skyrim', 'vanilla', 'projectIgnore', 'figma'])
    expect(r.find((c) => c.id === 'java')?.status).toBe('fail')
    expect(r.find((c) => c.id === 'ffdec')?.status).toBe('fail')
    expect(r.find((c) => c.id === 'papyrus')?.status).toBe('fail')
    expect(r.find((c) => c.id === 'skyrim')?.status).toBe('fail')
    expect(r.find((c) => c.id === 'vanilla')?.status).toBe('skipped')
    for (const c of r) expect(c.detail.length).toBeGreaterThan(5)
  })

  // Read-only run against THIS machine (real registry, real Steam, real Java/FFDec/compiler where present). It asserts shape only and prints the outcome.
  it('real run on this machine', async () => {
    const r = await runDoctor(ctx({}, { ...process.env }))
    console.log(r.map((c) => `${c.status.toUpperCase().padEnd(7)} ${c.id.padEnd(13)} ${c.detail}`).join('\n'))
    expect(r).toHaveLength(8)
    for (const c of r) expect(['pass', 'warn', 'fail', 'skipped']).toContain(c.status)
  }, 60000)
})
