import { useEffect, useState } from 'react'
import { ChevronDown, FolderCog, Rocket } from 'lucide-react'
import type { DeployTargetInfo } from '../../shared/deploy'
import { inkwell } from '../hooks/api'
import { useActiveSwf, useProject } from '../hooks/useProject'
import { useSyncState } from '../hooks/useSyncState'
import { useDeployStore } from '../state/deployStore'
import { useDialogStore } from '../state/dialogStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Dialog } from '../ui/Dialog'
import { Popover } from '../ui/Popover'

function Targets({ close }: { close(): void }) {
  const [targets, setTargets] = useState<DeployTargetInfo[]>()
  const swf = useActiveSwf()
  const project = useProject()
  const scope = useDeployStore((s) => s.scope)
  const setScope = useDeployStore((s) => s.setScope)
  const start = useDeployStore((s) => s.start)
  const show = useDialogStore((s) => s.show)
  // the settings may have changed while the Setup dialog was open: ask every time the menu opens
  useEffect(() => void inkwell?.getDeployTargets().then(setTargets), [project?.dir])
  const hasCustom = project?.swfs.some((s) => !s.orphaned && s.ir.target.kind === 'customMenu')
  return (
    <div className="details deploy-menu">
      <h3>{strings.deploy.targetsTitle}</h3>
      <ul className="menu" role="menu" aria-label={strings.deploy.menuLabel}>
        {targets?.filter((t) => t.id !== 'package').map((t) => {
          const off = t.disabledReason
          return (
            <li key={t.id} role="none">
              <button
                type="button"
                role="menuitem"
                className={`deploy-target${off ? ' is-disabled' : ''}`}
                aria-disabled={off ? true : undefined}
                title={off ? `${t.label}: ${off}` : strings.deploy.pathLabel(t.path ?? '')}
                data-testid={`deploy-${t.id}`}
                onClick={() => {
                  if (off || !(t.id === 'mo2Mod' || t.id === 'mo2Overwrite')) return
                  close()
                  void start(t.id, swf?.name)
                }}
              >
                <span className="deploy-target-name">{t.label}</span>
                <span className="deploy-target-path mono">{t.path ?? off}</span>
                {!off && <span className="dim">{t.confirmed ? strings.deploy.confirmed : strings.deploy.notConfirmed}</span>}
              </button>
            </li>
          )
        })}
      </ul>
      <fieldset className="scope">
        <legend>{strings.deploy.scopeLabel}</legend>
        <label className="check"><input type="radio" name="deploy-scope" checked={scope === 'all'} onChange={() => setScope('all')} /> {strings.deploy.scopeAll}</label>
        <label className="check"><input type="radio" name="deploy-scope" checked={scope === 'active'} disabled={!swf} onChange={() => setScope('active')} /> {strings.deploy.scopeActive(swf?.name)}</label>
      </fieldset>
      {hasCustom && <p className="dim">{strings.deploy.custom}</p>}
      <div className="row-actions">
        <Btn icon={FolderCog} onClick={() => { close(); show('settings') }} testId="deploy-folders">{strings.deploy.setFolders}</Btn>
      </div>
    </div>
  )
}

/** Top bar Deploy dropdown (UX 4.1, MO2 only): exact target paths, scope, and the first-deploy confirmation dialog. Build All stays separate. */
export function DeployMenu() {
  const project = useProject()
  const sync = useSyncState()
  const busy = useDeployStore((s) => s.busy)
  const reason = !project ? strings.deploy.noProject : !project.swfs.some((s) => !s.orphaned) ? strings.deploy.noSwfs : sync?.ffdec?.status === 'notFound' ? strings.deploy.noFfdec : undefined
  if (reason)
    return <Btn icon={Rocket} reason={reason} label={strings.top.deploy} testId="deploy">{strings.top.deploy}<ChevronDown size={12} aria-hidden="true" /></Btn>
  return (
    <>
      <Popover
        label={strings.deploy.menuLabel}
        align="end"
        trigger={(p, open) => (
          <button type="button" className="btn" {...p} data-testid="deploy" title={strings.top.deploy} aria-label={strings.top.deploy}>
            <Rocket size={14} aria-hidden="true" /> {busy ? strings.deploy.running : strings.top.deploy} <ChevronDown size={12} aria-hidden="true" className={open ? 'flip' : undefined} />
          </button>
        )}
      >
        {(close) => <Targets close={close} />}
      </Popover>
      <ConfirmDialog />
    </>
  )
}

/** First deploy to a folder: shows the exact path and every file before anything is written. */
export function ConfirmDialog() {
  const c = useDeployStore((s) => s.confirm)
  const accept = useDeployStore((s) => s.accept)
  const cancel = useDeployStore((s) => s.cancel)
  if (!c) return null
  const p = c.prepared
  const warnings = p.lint.filter((l) => l.severity !== 'info')
  return (
    <Dialog title={strings.deploy.confirmTitle} onClose={cancel}>
      <div data-testid="deploy-confirm">
        <p>{strings.deploy.confirmBody}</p>
        <p className="mono deploy-path" data-testid="deploy-confirm-path">{p.root}</p>
        <p><strong>{strings.deploy.confirmFiles(p.files.length)}</strong></p>
        <ul className="plain file-list mono" aria-label={strings.deploy.confirmFiles(p.files.length)}>
          {p.files.map((f) => <li key={f.rel}>{f.rel} <span className="dim">{f.size} B</span></li>)}
        </ul>
        {p.removed.length > 0 && <p>{strings.deploy.confirmRemoved(p.removed.length)}</p>}
        {warnings.length > 0 && (
          <>
            <h3>{strings.deploy.warnings}</h3>
            <ul className="plain">{warnings.map((l, i) => <li key={i} className="tone-warn"><span className="mono">{l.code}</span>: {l.message}</li>)}</ul>
          </>
        )}
        {p.notes.map((n, i) => <p key={i} className="dim">{n}</p>)}
        <p className="dim">{strings.deploy.confirmNote}</p>
        <div className="row-actions">
          <Btn variant="primary" onClick={() => void accept()} testId="deploy-confirm-ok">{strings.deploy.confirm}</Btn>
          <Btn onClick={cancel} testId="deploy-confirm-cancel">{strings.deploy.cancel}</Btn>
        </div>
      </div>
    </Dialog>
  )
}
