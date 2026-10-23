import { spawn as nodeSpawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { delimiter, join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { createStageTimer } from '../../shared/timing'

export interface FfdecJob {
  base: string
  /** Folder of `<characterId>.svg` files replacing shapes in base. */
  shapes?: string
  /** Folder of AS2 sources (frame_N/DoAction.as, __Packages/...). */
  scripts?: string
  out: string
}

export interface FfdecResult {
  ok: boolean
  /** Time the wrapper measured around the build itself. */
  ms: number
  /** Time seen by this client from sending the job to receiving the reply (includes stdin/stdout transport). */
  wallMs: number
  error?: string
  /** Dropped because a newer job for the same output arrived before this one started. */
  cancelled?: boolean
}

export interface ChildLike {
  stdin: Writable
  stdout: Readable
  on(event: 'exit' | 'error', cb: () => void): unknown
  kill(): unknown
}

export interface WrapperConfig {
  /** Path to the user's java executable. */
  javaPath: string
  /** The user's FFDec install dir (never bundled). */
  ffdecDir: string
  /** Built by `yarn build:wrapper`. */
  jarPath: string
  spawn?: (cmd: string, args: string[]) => ChildLike
}

interface Pending {
  id: string
  job: FfdecJob
  resolve: (r: FfdecResult) => void
}

export function createFfdecWrapper(cfg: WrapperConfig) {
  const doSpawn =
    cfg.spawn ?? ((cmd, args) => nodeSpawn(cmd, args, { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true }) as ChildLike)
  const timer = createStageTimer()
  const queue: Pending[] = []
  let child: ChildLike | undefined
  let current: Pending | undefined
  let n = 0
  const info: { ffdec?: string; versionMatch?: boolean } = {}

  const finish = (p: Pending, r: Omit<FfdecResult, 'wallMs'>): void => {
    const wallMs = timer.end('ffdec')
    timer.finishBuild()
    current = undefined
    p.resolve({ ...r, wallMs })
    pump()
  }

  function onExit(c: ChildLike): void {
    if (child !== c) return
    child = undefined // next build respawns
    if (current) finish(current, { ok: false, ms: 0, error: 'FFDec wrapper process died' })
    else pump()
  }

  function ensureChild(): ChildLike {
    if (child) return child
    const c = doSpawn(cfg.javaPath, [
      '-cp',
      [cfg.jarPath, join(cfg.ffdecDir, 'lib', 'ffdec_lib.jar'), join(cfg.ffdecDir, 'lib', '*')].join(delimiter),
      'com.inkwell.Wrapper'
    ])
    child = c
    c.on('exit', () => onExit(c))
    c.on('error', () => onExit(c))
    createInterface({ input: c.stdout }).on('line', (line) => {
      let m: { id?: string; ok?: boolean; ms?: number; error?: string; cancelled?: boolean; ready?: boolean; ffdec?: string; match?: boolean }
      try {
        m = JSON.parse(line)
      } catch {
        return // not protocol
      }
      if (m.ready) {
        info.ffdec = m.ffdec
        info.versionMatch = m.match
      } else if (current && m.id === current.id) {
        finish(current, { ok: !!m.ok, ms: m.ms ?? 0, ...(m.error === undefined ? {} : { error: m.error }) })
      }
    })
    return c
  }

  function pump(): void {
    if (current) return
    const next = queue.shift()
    if (!next) return
    current = next
    timer.start('ffdec')
    ensureChild().stdin.write(JSON.stringify({ id: next.id, ...next.job }) + '\n')
  }

  return {
    timer,
    info,
    /** Queues a build. A queued (not yet sent) job for the same `out` is dropped as stale; the running one is left to finish. */
    build(job: FfdecJob): Promise<FfdecResult> {
      return new Promise((resolve) => {
        for (let i = queue.length - 1; i >= 0; i--) {
          if (queue[i]!.job.out === job.out) {
            queue.splice(i, 1)[0]!.resolve({ ok: false, ms: 0, wallMs: 0, cancelled: true })
          }
        }
        queue.push({ id: String(++n), job, resolve })
        pump()
      })
    },
    stop(): void {
      const c = child
      child = undefined
      c?.stdin.end()
      c?.kill()
      for (const p of queue.splice(0)) p.resolve({ ok: false, ms: 0, wallMs: 0, cancelled: true })
      if (current) finish(current, { ok: false, ms: 0, error: 'stopped' })
    }
  }
}
