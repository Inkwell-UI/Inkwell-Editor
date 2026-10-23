import { CircleCheck, CircleDashed, CircleX, FolderOpen, Loader, RefreshCw, TriangleAlert, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CheckResult, Fix, PathSettingKey, SettingKey } from '../../shared/doctor'
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
      icon={busy ? Loader : a.kind === 'browse' ? FolderOpen : undefined}
      variant={primary ? 'primary' : 'default'}
      onClick={() => d.runFix(row.id, fix)}
      reason={d.busy && a.kind === 'run' && !busy ? strings.doctor.working : undefined}
      testId={`doctor-fix-${row.id}${extra ? '-extra' : ''}`}
    >
      {label}
    </Btn>
  )
}

function Row({ row, d }: { row: CheckResult; d: DoctorHook }) {
  const Icon = ICON[row.status]
  const title = strings.doctor.titles[row.id] ?? row.label
  const status = strings.doctor.status[row.status] ?? row.status
  return (
    <li className="doctor-row" data-testid={`doctor-${row.id}`} data-status={row.status}>
      <Icon size={16} className={TONE[row.status]} role="img" aria-label={strings.doctor.rowLabel(title, status)} />
      <div className="doctor-body">
        <strong>{title}</strong> <span className="dim">{status}</span>
        <p className="doctor-detail">{row.detail}</p>
        {(row.fix || row.extra?.length) && (
          <div className="row-actions">
            {row.fix && <FixButton row={row} fix={row.fix} d={d} primary={row.status === 'fail'} />}
            {row.extra?.map((f) => <FixButton key={f.label} row={row} fix={f} d={d} extra />)}
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

function Field({ name, d }: { name: 'mo2ModsDir' | 'mo2ModName' | 'mo2OverwriteDir'; d: DoctorHook }) {
  const value = d.settings?.[name] ?? ''
  const env = d.settings?.source[name] === 'env'
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const label = strings.doctor.fields[name] ?? name
  const commit = (): void => {
    const v = text.trim()
    if (v !== value) d.setSetting(name as SettingKey, v || null)
  }
  const folder = name !== 'mo2ModName'
  return (
    <div className="field">
      <label htmlFor={`setting-${name}`}>{label}</label>
      <div className="field-row">
        <input id={`setting-${name}`} data-testid={`setting-${name}`} className="input mono" value={text} placeholder={strings.doctor.notSet} disabled={env} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
        {folder && <Btn icon={FolderOpen} onClick={() => d.runFix(name, { label: strings.doctor.browse, action: { kind: 'browse', setting: name as PathSettingKey, folder: true } })} reason={env ? strings.doctor.fromEnv : undefined}>{strings.doctor.browse}</Btn>}
        <Btn icon={X} label={strings.doctor.clearTip(label)} onClick={() => d.setSetting(name, null)} reason={env ? strings.doctor.fromEnv : !value ? strings.doctor.notSet : undefined} />
      </div>
      {env && <p className="dim">{strings.doctor.fromEnv}</p>}
    </div>
  )
}

/** Setup Doctor (UX 5.3): one row per check (icon, detail, fix actions), Re-run, the two on-request tasks, and the deploy folders. Takes no props; the modal in shell/Dialogs.tsx and the first-launch flow just render it. */
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
      <ul className="plain checks" aria-label={strings.dialogs.doctor.title}>
        {d.results?.map((r) => <Row key={r.id} row={r} d={d} />)}
      </ul>
      <section className="doctor-folders">
        <h3>{strings.doctor.deployFolders}</h3>
        <p className="dim">{strings.doctor.deployFoldersNote}</p>
        <Field name="mo2ModsDir" d={d} />
        <Field name="mo2ModName" d={d} />
        <Field name="mo2OverwriteDir" d={d} />
      </section>
    </div>
  )
}
