import { Download, Loader, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { FIGMA_FACES, type FontToolProgress, type FontToolResult, type FontToolStatus } from '../../shared/fonts'
import { inkwell } from '../hooks/api'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Dialog } from '../ui/Dialog'
import { SettingItem } from '../ui/SettingItem'

const s = strings.fonts
/** Everything the section shows, lowercased, for the Settings search. */
export const FONTS_TEXT = [s.title, s.intro, s.notice, s.install, s.installMissing, s.remove, 'figma fonts everywhere futura', ...FIGMA_FACES.map((f) => `${f.family} ${f.style}`)].join(' ').toLowerCase()

const stepText = (p: FontToolProgress): string => (p.step === 'install' || p.step === 'remove' ? s.steps[p.step](p.done, p.total) : s.steps[p.step])

/** Settings row "Skyrim fonts" (Figma category, opt-in): notice, status, Install (after a confirmation that repeats the notice and lists the faces) and Remove. Never runs by itself. */
export function FontsForFigma() {
  const [status, setStatus] = useState<FontToolStatus>()
  const [loadError, setLoadError] = useState<string>()
  const [busy, setBusy] = useState<'install' | 'remove'>()
  const [progress, setProgress] = useState<FontToolProgress>()
  const [result, setResult] = useState<{ kind: 'install' | 'remove'; r: FontToolResult }>()
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    void inkwell?.getFontStatus().then(setStatus, (e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)))
    return inkwell?.onFontProgress(setProgress)
  }, [])
  const run = (kind: 'install' | 'remove'): void => {
    if (!inkwell) return
    setConfirm(false)
    setBusy(kind)
    setResult(undefined)
    setProgress(undefined)
    void (kind === 'install' ? inkwell.installFonts() : inkwell.removeFonts())
      .then(
        (r) => {
          setResult({ kind, r })
          setStatus(r.status)
        },
        (e: unknown) => setLoadError(e instanceof Error ? e.message : String(e))
      )
      .finally(() => {
        setBusy(undefined)
        setProgress(undefined)
      })
  }
  const installed = !!status?.installed
  const missing = status?.missing ?? FIGMA_FACES
  const complete = installed && missing.length === 0
  const toInstall = installed ? missing : FIGMA_FACES
  const notWin = status && !status.platformOk ? s.notWindows : undefined
  const r = result?.r
  return (
    <SettingItem
      name={s.title}
      value={status ? (installed ? s.statusInstalled(status.faces.length, status.faces.length + status.missing.length) : s.statusNone) : undefined}
      tone={busy ? 'busy' : installed && missing.length > 0 ? 'warn' : 'none'}
      autoOpen={!!(busy || result || loadError)}
      testId="fonts-figma"
    >
      <p className="dim">{s.intro}</p>
      <p className="banner banner-info fonts-notice" data-testid="fonts-notice"><span>{s.notice}</span></p>
      <p className="dim">{s.quality}</p>
      <div role="status" aria-label={s.statusLabel} data-testid="fonts-status">
        {status && <p><strong>{installed ? s.statusInstalled(status.faces.length, status.faces.length + status.missing.length) : s.statusNone}</strong></p>}
        {installed && (
          <ul className="plain fonts-faces">
            {status!.faces.map((f) => (
              <li key={f.file}>
                {f.family} / {f.style} {!f.present ? <span className="tone-warn">({s.missingFile})</span> : f.glyphs !== undefined && <span className="dim" data-testid="fonts-glyphs">{s.glyphs(f.glyphs)}</span>}
                {f.chars && <span className="dim mono"> {f.chars}</span>}
              </li>
            ))}
          </ul>
        )}
        {installed && status!.missing.length > 0 && (
          <>
            <p className="tone-warn" data-testid="fonts-missing">{s.statusMissing(status!.missing.length)}</p>
            <ul className="plain fonts-faces">
              {status!.missing.map((f) => (
                <li key={`${f.family}/${f.style}`}>{f.family} / {f.style}</li>
              ))}
            </ul>
          </>
        )}
        {status && <p className="dim mono fonts-where">{s.location(status.fontsDir, status.manifestPath)}</p>}
        {busy && (
          <p data-testid="fonts-progress">
            <Loader size={12} className="spin" aria-hidden="true" /> {progress ? stepText(progress) : s.working}
          </p>
        )}
      </div>
      {loadError && <p className="tone-error" role="alert">{s.loadFailed(loadError)}</p>}
      {r && !r.ok && (
        <p className="tone-error" role="alert" data-testid="fonts-error" data-code={r.code}>
          <strong>{s.errors[r.code] ?? r.code}.</strong> {r.error}
        </p>
      )}
      {r?.ok && <p className="tone-ok" data-testid="fonts-done">{result!.kind === 'install' ? s.installed : s.removed}</p>}
      {r?.ok && r.warnings.length > 0 && (
        <ul className="plain tone-warn" aria-label={s.warnings}>{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      )}
      <div className="row-actions">
        <Btn icon={Download} variant="primary" haspopup="dialog" onClick={() => setConfirm(true)} reason={busy ? s.working : notWin ?? (complete ? s.alreadyInstalled : undefined)} testId="fonts-install">{installed ? s.installMissing : s.install}</Btn>
        <Btn icon={Trash2} onClick={() => run('remove')} reason={busy ? s.working : !installed ? s.nothingInstalled : undefined} testId="fonts-remove">{s.remove}</Btn>
      </div>
      {confirm && (
        <Dialog title={installed ? s.confirmTitleMissing : s.confirmTitle} onClose={() => setConfirm(false)}>
          <div data-testid="fonts-confirm">
            <p className="banner banner-info"><span>{s.notice}</span></p>
            <p>{s.confirmFaces(toInstall.length)}</p>
            <ul className="plain fonts-faces" data-testid="fonts-confirm-faces">
              {toInstall.map((f) => (
                <li key={`${f.family}/${f.style}`}>
                  {f.family} / {f.style} <span className="dim mono">{f.aliases.join(', ')}</span>
                </li>
              ))}
            </ul>
            <p>{s.confirmWhere}</p>
            <p className="mono deploy-path">{status?.fontsDir}</p>
            <p className="dim">{s.confirmReversible}</p>
            <p className="dim">{s.quality}</p>
            <div className="row-actions">
              <Btn variant="primary" onClick={() => run('install')} testId="fonts-confirm-ok">{s.confirmAccept}</Btn>
              <Btn onClick={() => setConfirm(false)} testId="fonts-confirm-cancel">{s.cancel}</Btn>
            </div>
          </div>
        </Dialog>
      )}
    </SettingItem>
  )
}
