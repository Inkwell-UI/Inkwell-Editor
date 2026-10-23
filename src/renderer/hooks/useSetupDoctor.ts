import { useCallback, useEffect, useRef, useState } from 'react'
import { checksForSetting, mergeResults, type BenchmarkResult, type BuildCacheResult, type CheckId, type CheckResult, type Fix, type ResolvedSettings, type SetSettingResult, type SettingKey } from '../../shared/doctor'
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
  /** Settings being saved right now. */
  saving: SettingKey[]
  /** Checks being re-run right now (after a change, only the affected ones). */
  checking: CheckId[]
  /** Why the last change of a setting failed (IPC, disk, refused value); cleared by the next change of that setting. */
  errors: Partial<Record<SettingKey, string>>
  /** The last full run failed to reach the main process. */
  loadError: string | undefined
  rerun(): void
  runFix(rowId: string, fix: Fix): void
  setSetting(key: SettingKey, value: string | null): void
  browse(key: SettingKey, folder: boolean): void
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** State of the Setup Doctor: the checks (run on mount and on demand), settings, and the results of the two user-triggered tasks. A changed setting re-runs only the checks it affects, and any failure ends up in `errors`, never swallowed. */
export function useSetupDoctor(): DoctorHook {
  const [results, setResults] = useState<CheckResult[]>()
  const [settings, setSettings] = useState<ResolvedSettings>()
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState<DoctorHook['busy']>()
  const [benchmark, setBenchmark] = useState<BenchmarkResult>()
  const [cache, setCache] = useState<BuildCacheResult>()
  const [copied, setCopied] = useState<string>()
  const [saving, setSaving] = useState<SettingKey[]>([])
  const [checking, setChecking] = useState<CheckId[]>([])
  const [loadError, setLoadError] = useState<string>()
  const [errors, setErrors] = useState<DoctorHook['errors']>({})
  // set true on every mount: React StrictMode (dev) mounts, unmounts and mounts again, and a flag only ever cleared would drop every later update
  const alive = useRef(false)
  useEffect(() => {
    alive.current = true
    return () => void (alive.current = false)
  }, [])

  const rerun = useCallback(() => {
    if (!inkwell) return
    setRunning(true)
    void Promise.all([inkwell.runDoctor(), inkwell.getSettings()])
      .then(([r, s]) => alive.current && (setResults(r), setSettings(s)))
      .then(() => alive.current && setLoadError(undefined), (e: unknown) => alive.current && setLoadError(message(e)))
      .finally(() => alive.current && setRunning(false))
  }, [])
  useEffect(rerun, [rerun])

  const setError = (key: SettingKey, error: string | undefined): void =>
    setErrors((x) => {
      const n = { ...x }
      if (error) n[key] = error
      else delete n[key]
      return n
    })

  /** One change: save, then re-run only the affected checks and merge them in. */
  const commit = useCallback((key: SettingKey, saveIt: () => Promise<SetSettingResult>) => {
    setSaving((s) => [...s, key])
    setError(key, undefined)
    const done = (): void => void (alive.current && setSaving((s) => s.filter((k, i) => !(k === key && i === s.indexOf(key)))))
    void saveIt()
      .then(async (r) => {
        if (!alive.current) return
        if (!r.ok) return setError(key, r.error)
        setSettings(r.settings)
        if (r.cancelled) return
        const ids = checksForSetting(key)
        setChecking((c) => [...c, ...ids])
        try {
          const fresh = await inkwell!.runDoctor(ids)
          if (alive.current) setResults((old) => mergeResults(old, fresh))
        } catch (e) {
          if (alive.current) setError(key, `${strings.doctor.errorLabel(strings.doctor.fields[key] ?? key)}: ${message(e)}`)
        } finally {
          if (alive.current) setChecking((c) => c.filter((x) => !ids.includes(x)))
        }
      })
      .catch((e: unknown) => alive.current && setError(key, `${strings.doctor.errorLabel(strings.doctor.fields[key] ?? key)}: ${message(e)}`))
      .finally(done)
  }, [])

  const setSetting = useCallback((key: SettingKey, value: string | null) => {
    if (inkwell) commit(key, () => inkwell!.setSetting(key, value))
  }, [commit])

  const browse = useCallback((key: SettingKey, folder: boolean) => {
    if (inkwell) commit(key, () => inkwell!.browseSetting(key as never, folder, strings.doctor.browseTitle(strings.doctor.fields[key] ?? key)))
  }, [commit])

  const runFix = useCallback(
    (rowId: string, fix: Fix) => {
      if (!inkwell) return
      const a = fix.action
      if (a.kind === 'copy') void navigator.clipboard?.writeText(a.text).then(() => alive.current && setCopied(rowId))
      else if (a.kind === 'open') void inkwell.openExternal(a.url)
      else if (a.kind === 'browse') browse(a.setting, a.folder)
      else if (a.kind === 'clear') setSetting(a.setting, null)
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
    [rerun, browse, setSetting]
  )

  return { results, settings, running, busy, benchmark, cache, copied, saving, checking, errors, loadError, rerun, runFix, setSetting, browse }
}
