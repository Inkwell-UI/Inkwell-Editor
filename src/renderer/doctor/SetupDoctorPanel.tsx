import { CircleAlert, CircleCheck, CircleDashed, CircleX, FolderOpen, Loader, RefreshCw, TriangleAlert, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ROW_SETTINGS, type CheckResult, type Fix, type SettingKey } from '../../shared/doctor'
import { useSetupDoctor, type DoctorHook } from '../hooks/useSetupDoctor'
import { formatMs } from '../model/statusBar'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'

const ICON = { pass: CircleCheck, warn: TriangleAlert, fail: CircleX, skipped: CircleDashed } as const
const TONE = { pass: 'tone-ok', warn: 'tone-warn', fail: 'tone-error', skipped: '' } as const

function FixButton({ row, fix, d, primary, extra }: { row: CheckResult; fix: Fix; d: DoctorHook; primary?: boolean; extra?: boolean }) {
  const a = fix.action
  const busy = a.kind === 'run' && d.busy === a.task
  const label = a.kind === 'copy' && d.copied === row.id ? strings.doctor.copied : busy ? strings.doctor.working : fix.label
  return (
    <Btn
      icon={busy ? Loader : a.kind === 'browse' ? FolderOpen : a.kind === 'clear' ? X : undefined}
      variant={primary ? 'primary' : 'default'}
      onClick={() => d.runFix(row.id, fix)}
      reason={d.busy && a.kind === 'run' && !busy ? strings.doctor.working : undefined}
      testId={`doctor-fix-${row.id}${extra ? '-extra' : ''}`}
    >
      {label}
    </Btn>
  )
}

/** One path (or text) setting of a row: editable input, Browse, Clear, where the value comes from, a busy state, and every problem or error inline. Enter, blur and Browse all save and re-run only the affected checks. */
function SettingField({ name, folder, row, d }: { name: SettingKey; folder: boolean; row: CheckResult; d: DoctorHook }) {
  const s = d.settings as unknown as (Record<string, string | undefined> & { source: Record<string, string>; problems?: Record<string, string> }) | undefined
  const src = s?.source[name]
  const env = src === 'env'
  const stored = src === 'settings' || env ? (s?.[name] ?? '') : ''
  const hint = name === 'mo2ModName' ? strings.doctor.modNamePlaceholder : src === 'default' ? s?.[name] : row.found?.value
  const shownSource = stored ? src : src === 'default' ? 'default' : row.found?.source
  const [text, setText] = useState(stored)
  const submitted = useRef(stored) // Enter and blur both commit; the second one must not save again
  useEffect(() => {
    setText(stored)
    submitted.current = stored
  }, [stored])
  const label = strings.doctor.fields[name] ?? name
  const envName = strings.doctor.envVars[name] ?? ''
  const saving = d.saving.includes(name)
  const checking = d.checking.includes(row.id)
  const problem = s?.problems?.[name]
  const error = d.errors[name]
  const id = `setting-${name}`
  // reads the input itself, not `text`: a paste followed at once by Enter reaches this before React has re-rendered the new state
  const commit = (el: HTMLInputElement): void => {
    const v = el.value.trim()
    if (env || v === submitted.current) return
    submitted.current = v
    d.setSetting(name, v || null)
  }
  return (
    <div className="field" data-testid={`field-${name}`} data-busy={saving || checking ? 'true' : undefined}>
      <div className="field-head">
        <label htmlFor={id}>{label}</label>
        {shownSource && <span className="source-badge" data-testid={`source-${name}`} title={env ? strings.doctor.fromEnv(envName) : undefined}>{strings.doctor.sourceLabel(shownSource, envName)}</span>}
        {(saving || checking) && (
          <span className="dim" role="status">
            <Loader size={12} className="spin" aria-hidden="true" /> {saving ? strings.doctor.saving : strings.doctor.checking}
          </span>
        )}
      </div>
      <div className="field-row">
        <input
          id={id}
          data-testid={id}
          className={`input mono${problem || error ? ' has-problem' : ''}`}
          value={text}
          placeholder={hint ?? strings.doctor.notSet}
          readOnly={env}
          title={env ? strings.doctor.fromEnv(envName) : strings.doctor.commitHint}
          aria-invalid={problem || error ? true : undefined}
          aria-describedby={problem || error ? `${id}-msg` : undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.currentTarget)}
          onKeyDown={(e) => e.key === 'Enter' && commit(e.currentTarget)}
        />
        {name !== 'mo2ModName' && (
          <Btn icon={FolderOpen} onClick={() => d.browse(name, folder)} reason={env ? strings.doctor.fromEnv(envName) : undefined} label={strings.doctor.browseTip(label)} testId={`browse-${name}`}>{strings.doctor.browse}</Btn>
        )}
        <Btn icon={X} label={strings.doctor.clearTip(label)} onClick={() => d.setSetting(name, null)} reason={env ? strings.doctor.fromEnv(envName) : !stored ? strings.doctor.nothingToClear : undefined} testId={`clear-${name}`} />
      </div>
      <div id={`${id}-msg`}>
        {problem && <p className="field-msg tone-error" role="alert" data-testid={`problem-${name}`}><CircleAlert size={14} aria-label={strings.doctor.problemLabel(label)} role="img" />{problem}</p>}
        {error && <p className="field-msg tone-error" role="alert" data-testid={`error-${name}`}><CircleAlert size={14} aria-label={strings.doctor.errorLabel(label)} role="img" />{error}</p>}
      </div>
    </div>
  )
}

function Row({ row, d }: { row: CheckResult; d: DoctorHook }) {
  const checking = d.checking.includes(row.id)
  const Icon = checking ? Loader : ICON[row.status]
  const title = strings.doctor.titles[row.id] ?? row.label
  const status = checking ? strings.doctor.checking : (strings.doctor.status[row.status] ?? row.status)
  const fields = ROW_SETTINGS[row.id]
  // Browse fixes whose setting has an input in this row would only repeat that input's Browse button
  const own = (f: Fix): boolean => f.action.kind === 'browse' && !!fields?.some((x) => x.key === (f.action as { setting: string }).setting)
  const fix = row.fix && !own(row.fix) ? row.fix : undefined
  const extra = row.extra?.filter((f) => !own(f))
  return (
    <li className="doctor-row" data-testid={`doctor-${row.id}`} data-status={checking ? 'checking' : row.status} aria-busy={checking || undefined}>
      <Icon size={16} className={checking ? 'spin' : TONE[row.status]} role="img" aria-label={strings.doctor.rowLabel(title, status)} />
      <div className="doctor-body">
        <strong>{title}</strong> <span className="dim">{status}</span>
        <p className="doctor-detail" data-testid={`doctor-detail-${row.id}`}>{row.detail}</p>
        {fields && (
          <div className="doctor-fields">
            {fields.map((f) => <SettingField key={f.key} name={f.key} folder={f.folder} row={row} d={d} />)}
          </div>
        )}
        {(fix || extra?.length) && (
          <div className="row-actions">
            {fix && <FixButton row={row} fix={fix} d={d} primary={row.status === 'fail'} />}
            {extra?.map((f) => <FixButton key={f.label} row={row} fix={f} d={d} extra />)}
          </div>
        )}
        {row.id === 'wrapper' && d.benchmark && <Benchmark d={d} />}
        {row.id === 'vanilla' && d.cache && (
          <p className={d.cache.ok ? 'tone-ok' : 'tone-error'}>{d.cache.ok ? strings.doctor.cacheDone(d.cache.entries ?? 0, ((d.cache.bytes ?? 0) / 1048576).toFixed(1)) : strings.doctor.cacheFailed(d.cache.error)}</p>
        )}
      </div>
    </li>
  )
}

function Benchmark({ d }: { d: DoctorHook }) {
  const b = d.benchmark!
  return (
    <div className="doctor-bench" data-testid="doctor-benchmark">
      <h4>{strings.doctor.benchmarkTitle}</h4>
      {!b.ok && <p className="tone-error">{strings.doctor.benchmarkFailed(b.error)}</p>}
      <table>
        <tbody>
          {strings.doctor.benchmarkRows(b).map(([name, ms]) => ms !== undefined && <tr key={name}><td>{name}</td><td className="mono">{formatMs(ms)}</td></tr>)}
        </tbody>
      </table>
    </div>
  )
}

/** Setup Doctor (UX 5.3): one row per check (icon, detail, its editable settings, fix actions), Re-run and the two on-request tasks. Takes no props; the modal in shell/Dialogs.tsx and the first-launch flow just render it. */
export function SetupDoctorPanel() {
  const d = useSetupDoctor()
  const count = (s: string): number => d.results?.filter((r) => r.status === s).length ?? 0
  return (
    <div className="doctor" data-testid="setup-doctor">
      <p>{strings.doctor.intro}</p>
      <div className="doctor-head">
        <Btn icon={RefreshCw} onClick={d.rerun} reason={d.running ? strings.doctor.running : undefined} label={strings.doctor.rerunTip} testId="doctor-rerun">{strings.doctor.rerun}</Btn>
        <span className="dim" role="status">{d.running ? strings.doctor.running : d.results ? strings.doctor.summary(count('pass'), count('warn'), count('fail')) : ''}</span>
      </div>
      {d.loadError && <p className="tone-error" role="alert" data-testid="doctor-load-error">{strings.doctor.loadFailed(d.loadError)}</p>}
      <ul className="plain checks" aria-label={strings.dialogs.doctor.title}>
        {d.results?.map((r) => <Row key={r.id} row={r} d={d} />)}
      </ul>
    </div>
  )
}
