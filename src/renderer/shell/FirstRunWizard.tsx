import { Check, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { ROW_SETTINGS, type CheckId, type CheckResult, type Fix } from '../../shared/doctor'
import { FixButton, SettingField } from '../doctor/SetupDoctorPanel'
import { useSetupDoctor, type DoctorHook } from '../hooks/useSetupDoctor'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'

const t = strings.firstRun
/** Steps 2 to 4 and the checks each one shows (the same checks as the Setup Doctor). */
const STEP_CHECKS: Record<number, CheckId[]> = { 1: ['java', 'ffdec', 'papyrus'], 2: ['skyrim', 'mo2'], 3: ['figma'] }
const COPY = [null, [t.toolsTitle, t.toolsBody], [t.skyrimTitle, t.skyrimBody], [t.figmaTitle, t.figmaBody]] as const
/** Settings the Settings view offers but a first run does not need. */
const HIDDEN_FIELDS = ['mo2ModName', 'mo2OverwriteDir']

function WizardCheck({ row, d }: { row: CheckResult; d: DoctorHook }) {
  const checking = d.checking.includes(row.id)
  const fields = ROW_SETTINGS[row.id]
  // a Browse fix whose setting already has a field in this row would only repeat that field's Browse button
  const own = row.fix?.action.kind === 'browse' && fields?.some((x) => x.key === (row.fix!.action as { setting: string }).setting)
  // a tool with a download page: while its path is unset and the check is not ready, its field gets a download button in place of Clear
  const key = fields?.[0]?.key
  const src = key ? (d.settings?.source as Record<string, string> | undefined)?.[key] : undefined
  const get: Fix | undefined = row.id === 'java' || row.id === 'ffdec' || row.id === 'papyrus' ? [row.fix, ...(row.extra ?? [])].find((f) => f?.action.kind === 'open') : undefined
  const offerGet = !!get && row.status !== 'pass' && src !== 'settings' && src !== 'env'
  // the plugin file's Copy sits inside its field
  const copy = row.id === 'figma' && row.fix?.action.kind === 'copy' ? row.fix : undefined
  const fix = row.fix && !own && !(offerGet && row.fix === get) && row.fix !== copy ? row.fix : undefined
  return (
    <div className="wiz-check" data-testid={`wiz-${row.id}`}>
      <div className="wiz-check-head">
        <span className="wiz-dot" data-status={checking ? 'busy' : row.status} aria-hidden="true" />
        <b>{strings.doctor.titles[row.id] ?? row.label}</b>
        <span className="dim">{checking ? t.checking : t.status[row.status]}</span>
        <span className="wiz-gap" />
        {fix && <FixButton row={row} fix={fix} d={d} primary={row.status === 'fail'} />}
      </div>
      {!checking && row.status !== 'pass' && <p className="dim wiz-detail">{(offerGet && t.notSet[row.id]) || row.detail}</p>}
      {fields?.filter((f) => !HIDDEN_FIELDS.includes(f.key)).map((f) => <SettingField key={f.key} name={f.key} folder={f.folder} row={row} d={d} download={offerGet && f.key === key ? get : undefined} copy={f.key === key ? copy : undefined} />)}
    </div>
  )
}

/** First launch only (AppShell): welcome, build tools, Skyrim, Figma. Reads and writes the same settings as Edit > Settings. */
export function FirstRunWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0)
  const d = useSetupDoctor()
  const last = t.steps.length - 1
  const rows = (STEP_CHECKS[step] ?? []).map((id) => d.results?.find((r) => r.id === id)).filter((r): r is CheckResult => !!r)
  // a step already passed shows how it ended: a check mark, or a warning when one of its checks needs attention
  const outcome = (i: number): 'ok' | 'warn' | 'fail' => {
    const s = (STEP_CHECKS[i] ?? []).map((id) => d.results?.find((r) => r.id === id)?.status)
    return s.includes('fail') ? 'fail' : s.includes('warn') ? 'warn' : 'ok'
  }
  return (
    <section className="wiz" aria-label={t.label}>
      <ol className="wiz-rail" style={{ listStyle: 'none', margin: 0 }}>
        {t.steps.map((name, i) => (
          <li key={name}>
            <button type="button" className="wiz-step" aria-current={i === step ? 'step' : undefined} data-state={i < step ? outcome(i) : undefined} onClick={() => setStep(i)}>
              <span className="wiz-num">{i >= step ? i + 1 : outcome(i) === 'ok' ? <Check size={11} aria-hidden="true" /> : <TriangleAlert size={11} aria-hidden="true" />}</span>
              {name}
            </button>
          </li>
        ))}
      </ol>
      <div className="wiz-stage">
        <div className="wiz-pane">
          {step === 0 ? (
            <>
              <h1>{t.welcomeTitle}</h1>
              <p className="dim">{t.welcomeBody}</p>
              <ul className="wiz-points">{t.welcomePoints.map((p) => <li key={p}>{p}</li>)}</ul>
            </>
          ) : (
            <>
              <div>
                <h1>{COPY[step]![0]}</h1>
                <p className="dim">{COPY[step]![1]}</p>
                {step === 3 && <p className="dim">{t.figmaOptional}</p>}
              </div>
              {d.loadError && <p role="alert" className="tone-error">{strings.doctor.loadFailed(d.loadError)}</p>}
              {!d.results && !d.loadError && <p className="dim" role="status">{strings.doctor.running}</p>}
              {rows.map((r) => <WizardCheck key={r.id} row={r} d={d} />)}
            </>
          )}
          <div className="wiz-foot">
            {step < last && <Btn variant="quiet" onClick={onDone}>{t.skip}</Btn>}
            <span className="wiz-foot-gap" />
            <span className="dim">{t.stepOf(step + 1, t.steps.length)}</span>
            {step > 0 && <Btn onClick={() => setStep(step - 1)}>{t.back}</Btn>}
            <Btn variant="primary" onClick={() => (step === last ? onDone() : setStep(step + 1))} testId="wiz-next">{step === last ? t.finish : t.next}</Btn>
          </div>
        </div>
      </div>
    </section>
  )
}
