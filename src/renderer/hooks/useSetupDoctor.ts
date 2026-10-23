import { useCallback, useEffect, useRef, useState } from 'react'
import type { BenchmarkResult, BuildCacheResult, CheckResult, Fix, ResolvedSettings, SettingKey } from '../../shared/doctor'
import { strings } from '../strings'
import { inkwell } from './api'

export interface DoctorHook {
  results: CheckResult[] | undefined
  settings: ResolvedSettings | undefined
  running: boolean
  /** Task started from a fix button (benchmark, cache build), if one runs. */
  busy: 'benchmark' | 'buildVanillaCache' | undefined
  benchmark: BenchmarkResult | undefined
  cache: BuildCacheResult | undefined
  /** Id of the row whose Copy button was just used. */
  copied: string | undefined
  rerun(): void
  runFix(rowId: string, fix: Fix): void
  setSetting(key: SettingKey, value: string | null): void
}

/** State of the Setup Doctor: the checks (run on mount and on demand), settings, and the results of the two user-triggered tasks. */
export function useSetupDoctor(): DoctorHook {
  const [results, setResults] = useState<CheckResult[]>()
  const [settings, setSettings] = useState<ResolvedSettings>()
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState<DoctorHook['busy']>()
  const [benchmark, setBenchmark] = useState<BenchmarkResult>()
  const [cache, setCache] = useState<BuildCacheResult>()
  const [copied, setCopied] = useState<string>()
  const alive = useRef(true)
  useEffect(() => () => void (alive.current = false), [])

  const rerun = useCallback(() => {
    if (!inkwell) return
    setRunning(true)
    void Promise.all([inkwell.runDoctor(), inkwell.getSettings()])
      .then(([r, s]) => alive.current && (setResults(r), setSettings(s)))
      .finally(() => alive.current && setRunning(false))
  }, [])
  useEffect(rerun, [rerun])

  const runFix = useCallback(
    (rowId: string, fix: Fix) => {
      if (!inkwell) return
      const a = fix.action
      if (a.kind === 'copy') void navigator.clipboard?.writeText(a.text).then(() => alive.current && setCopied(rowId))
      else if (a.kind === 'open') void inkwell.openExternal(a.url)
      else if (a.kind === 'browse') void inkwell.browseSetting(a.setting, a.folder, strings.doctor.browseTitle(a.setting)).then((s) => void (s && rerun()))
      else {
        setBusy(a.task)
        const done = (): void => void (alive.current && setBusy(undefined))
        if (a.task === 'benchmark') void inkwell.runBenchmark().then((b) => void (alive.current && setBenchmark(b))).finally(done)
        else
          void inkwell
            .buildVanillaCache()
            .then((c) => void (alive.current && (setCache(c), rerun())))
            .finally(done)
      }
    },
    [rerun]
  )

  const setSetting = useCallback(
    (key: SettingKey, value: string | null) => {
      if (inkwell) void inkwell.setSetting(key, value).then((s) => alive.current && (setSettings(s), rerun()))
    },
    [rerun]
  )

  return { results, settings, running, busy, benchmark, cache, copied, rerun, runFix, setSetting }
}
