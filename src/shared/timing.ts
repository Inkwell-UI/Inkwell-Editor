export interface BuildTiming {
  stages: Record<string, number>
  total: number
}

export function createStageTimer(opts: { now?: () => number; keep?: number } = {}) {
  const now = opts.now ?? (() => performance.now())
  const keep = opts.keep ?? 10
  let buildStart: number | undefined
  let open = new Map<string, number>()
  let stages: Record<string, number> = {}
  const history: BuildTiming[] = []

  return {
    start(name: string): void {
      const t = now()
      buildStart ??= t
      open.set(name, t)
    },
    /** Ends a stage and returns its duration (ms). Repeated stages accumulate. */
    end(name: string): number {
      const t0 = open.get(name)
      if (t0 === undefined) throw new Error(`Stage not started: ${name}`)
      open.delete(name)
      const d = now() - t0
      stages[name] = (stages[name] ?? 0) + d
      return d
    },
    /** Closes the current build (wall time from first start), stores it, returns it. */
    finishBuild(): BuildTiming {
      if (buildStart === undefined) throw new Error('No build in progress')
      if (open.size) throw new Error(`Stages still open: ${[...open.keys()].join(', ')}`)
      const build = { stages, total: now() - buildStart }
      history.push(build)
      if (history.length > keep) history.shift()
      buildStart = undefined
      open = new Map()
      stages = {}
      return build
    },
    /** Last N finished builds, oldest first. */
    builds: (): readonly BuildTiming[] => history
  }
}
