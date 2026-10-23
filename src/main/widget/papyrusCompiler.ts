import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { LintIssue } from '../swf/lint'
import type { PapyrusScript } from './papyrus'

/** Header stubs shipped with the editor (original, written from scratch; no Bethesda or SkyUI files). */
export const STUBS_DIR = resolve(__dirname, '../../../resources/papyrus-stubs')

/** Path of the user's russo `papyrus.exe` from `INKWELL_PAPYRUS`. The compiler is user-installed and run as a separate process, never bundled. */
export function papyrusFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const p = env['INKWELL_PAPYRUS']
  if (!p) throw new Error('INKWELL_PAPYRUS is not set. Point it at the russo papyrus-compiler "papyrus.exe" (see docs/hud-widget.md).')
  if (!existsSync(p)) throw new Error(`INKWELL_PAPYRUS points at "${p}", which does not exist.`)
  return p
}

export interface PapyrusResult {
  /** Compiled scripts by script name. Empty when compilation failed. */
  pex: Record<string, Buffer>
  lint: LintIssue[]
}

/** `<file>.psc:<line>:<col>: Checker error: <message>` (the source excerpt lines that follow are dropped). */
const DIAG = /^(.+?\.psc):(\d+):(\d+): (.*?)\b(error|warning): (.*)$/i

export function parseDiagnostics(output: string): LintIssue[] {
  const seen = new Set<string>()
  const out: LintIssue[] = []
  for (const line of output.split(/\r?\n/)) {
    const m = DIAG.exec(line)
    if (!m) continue
    const script = (m[1]!.split(/[\\/]/).pop() ?? m[1]!).replace(/\.psc$/i, '')
    const text = `${script}.psc:${m[2]}:${m[3]}: ${m[6]}`
    if (seen.has(text)) continue // the compiler reports some errors twice
    seen.add(text)
    out.push({ severity: m[5]!.toLowerCase() === 'error' ? 'error' : 'warning', code: 'papyrus-compile-failed', message: text, nodeId: script })
  }
  return out
}

/** Compiles `scripts` with the user's compiler against the stubs. Never throws on compile errors: they come back as lint issues (code `papyrus-compile-failed`). */
export async function compilePapyrus(o: { papyrusExe: string; scripts: PapyrusScript[]; workDir: string; stubsDir?: string }): Promise<PapyrusResult> {
  const src = join(o.workDir, 'src')
  const out = join(o.workDir, 'out')
  await rm(o.workDir, { recursive: true, force: true })
  await mkdir(src, { recursive: true })
  await mkdir(out, { recursive: true })
  for (const s of o.scripts) await writeFile(join(src, `${s.name}.psc`), s.source)

  const run = await new Promise<{ code: number | null; text: string; spawnError?: string }>((done) => {
    execFile(o.papyrusExe, ['compile', '-nocache', '-h', o.stubsDir ?? STUBS_DIR, '-i', src, '-o', out], { maxBuffer: 16 << 20 }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : null) : 0
      done({ code, text: `${stdout}\n${stderr}`, ...(err && typeof err.code !== 'number' ? { spawnError: err.message } : {}) })
    })
  })
  const lint = parseDiagnostics(run.text)
  const pex: Record<string, Buffer> = {}
  if (run.code === 0) for (const s of o.scripts) pex[s.name] = await readFile(join(out, `${s.name}.pex`)).catch(() => Buffer.alloc(0))
  const missing = o.scripts.filter((s) => run.code === 0 && pex[s.name]!.length === 0)
  if (run.code !== 0 && !lint.some((l) => l.severity === 'error'))
    lint.push({ severity: 'error', code: 'papyrus-compile-failed', message: run.spawnError ?? `The Papyrus compiler exited with code ${run.code}.`, nodeId: o.scripts[0]?.name ?? '' })
  for (const s of missing) lint.push({ severity: 'error', code: 'papyrus-compile-failed', message: `No ${s.name}.pex was produced.`, nodeId: s.name })
  return { pex: run.code === 0 ? pex : {}, lint }
}
