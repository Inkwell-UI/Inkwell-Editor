// Runs only when Java, the user's FFDec and the built wrapper jar exist (yarn build:wrapper). INKWELL_BENCH=1 also prints timings.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { describe, expect, it } from 'vitest'
import { createFfdecWrapper } from './ffdecWrapper'

const ffdecDir = process.env['INKWELL_FFDEC'] ?? 'C:\\Program Files (x86)\\FFDec'
const javaPath = process.env['INKWELL_JAVA'] ?? 'java'
const jarPath = resolve(__dirname, '../../../tools/ffdec-wrapper/build/ffdec-wrapper.jar')
const fx = resolve(__dirname, '../../../tests/fixtures/ffdec')

const hasJava = (() => {
  try {
    execFileSync(javaPath, ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
const can = hasJava && existsSync(join(ffdecDir, 'lib', 'ffdec_lib.jar')) && existsSync(jarPath)

const mk = () => createFfdecWrapper({ javaPath, ffdecDir, jarPath })
const job = (out: string) => ({ base: join(fx, 'base.swf'), shapes: join(fx, 'shapes'), scripts: join(fx, 'as2'), out })
const stats = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b)
  return `n=${s.length} min=${s[0]!.toFixed(1)} median=${s[s.length >> 1]!.toFixed(1)} max=${s.at(-1)!.toFixed(1)}`
}

describe.skipIf(!can)('ffdec wrapper (real FFDec)', () => {
  it('builds the sample SWF byte-identically, survives a bad job, cancels queued jobs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-ffdec-'))
    const w = mk()
    try {
      const a = await w.build(job(join(dir, 'a.swf')))
      expect(a).toMatchObject({ ok: true })
      const bad = await w.build({ base: join(dir, 'missing.swf'), out: join(dir, 'x.swf') })
      expect(bad.ok).toBe(false)
      const b = await w.build(job(join(dir, 'b.swf')))
      expect(b.ok).toBe(true)
      expect(w.info.versionMatch).toBe(true)
      const A = readFileSync(join(dir, 'a.swf'))
      expect(['FWS', 'CWS']).toContain(A.subarray(0, 3).toString('latin1'))
      expect(A.equals(readFileSync(join(dir, 'b.swf')))).toBe(true)
    } finally {
      w.stop()
    }

    // Raw protocol: job 2 is queued behind job 1 and is cancelled before it starts.
    const cp = [jarPath, join(ffdecDir, 'lib', 'ffdec_lib.jar'), join(ffdecDir, 'lib', '*')].join(';')
    const p = spawn(javaPath, ['-cp', cp, 'com.inkwell.Wrapper'], { stdio: ['pipe', 'pipe', 'inherit'] })
    const lines: Record<string, unknown>[] = []
    createInterface({ input: p.stdout }).on('line', (l) => lines.push(JSON.parse(l)))
    const send = (o: object) => p.stdin.write(JSON.stringify(o) + '\n')
    send({ id: '1', ...job(join(dir, 'c1.swf')) })
    send({ id: '2', ...job(join(dir, 'c2.swf')) })
    send({ cmd: 'cancel', id: '2' })
    send({ id: '3', base: 'nope', out: 'x' })
    await new Promise<void>((r) => {
      const t = setInterval(() => lines.length >= 4 && (clearInterval(t), r()), 20)
    })
    p.stdin.end()
    expect(lines.slice(1).map((l) => [l['id'], l['ok'], l['cancelled'] ?? false])).toEqual([
      ['2', false, true],
      ['1', true, false],
      ['3', false, false]
    ])
  }, 30000)

  it.skipIf(!process.env['INKWELL_BENCH'])('bench', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-bench-'))
    const out = join(dir, 'o.swf')
    const cli: number[] = []
    for (let i = 0; i < 10; i++) {
      const t = performance.now()
      execFileSync(join(ffdecDir, 'ffdec-cli.exe'), ['-importShapes', join(fx, 'base.swf'), join(dir, 'm.swf'), join(fx, 'shapes')], { stdio: 'ignore' })
      execFileSync(join(ffdecDir, 'ffdec-cli.exe'), ['-importScript', join(dir, 'm.swf'), out, join(fx, 'as2')], { stdio: 'ignore' })
      cli.push(performance.now() - t)
    }
    const first: number[] = [], firstWall: number[] = [], warm: number[] = [], warmWall: number[] = []
    for (let run = 0; run < 5; run++) {
      const w = mk()
      const t0 = performance.now()
      const r1 = await w.build(job(out))
      first.push(r1.ms)
      firstWall.push(performance.now() - t0) // includes JVM spawn + class loading
      for (let i = 2; i <= 30; i++) {
        const r = await w.build(job(out))
        warm.push(r.ms)
        warmWall.push(r.wallMs)
      }
      w.stop()
    }
    console.log(
      [`COLD CLI x2 (shapes+script): ${stats(cli)}`, `FIRST job wrapper ms: ${stats(first)}`, `FIRST job incl. spawn (client wall): ${stats(firstWall)}`,
       `WARM 2..30 wrapper ms: ${stats(warm)}`, `WARM 2..30 client wall ms: ${stats(warmWall)}`].join('\n')
    )
  }, 300000)
})
