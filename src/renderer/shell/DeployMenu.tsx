import { useEffect, useState } from 'react'
import { ChevronDown, FolderCog, Rocket } from 'lucide-react'
import { isPackageTarget, type DeployLintItem, type DeployTargetInfo } from '../../shared/deploy'
import { inkwell } from '../hooks/api'
import { useActiveSwf, useDockRows, useProject } from '../hooks/useProject'
import { countSeverities } from '../model/lintRows'
import { useProjectStore } from '../state/projectStore'
import { useSelectionStore } from '../state/selectionStore'
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
  const lint = countSeverities(useDockRows()) // what the dock shows now; the deploy itself is gated in main on the deployed SWFs
  return (
    <div className="details deploy-menu">
      <h3>{strings.deploy.targetsTitle}</h3>
      <ul className="menu" role="menu" aria-label={strings.deploy.menuLabel}>
        {targets?.map((t) => {
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
                  if (off) return
                  close()
                  void start(t.id, swf?.name)
                }}
              >
                <span className="deploy-target-name">{t.label}</span>
                <span className="deploy-target-path mono">{t.path ?? off}</span>
                {!off && <span className="dim">{isPackageTarget(t.id) ? strings.deploy.targetNotes[t.id] : t.confirmed ? strings.deploy.confirmed : strings.deploy.notConfirmed}</span>}
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
      <p className={lint.errors ? 'tone-error' : 'dim'} data-testid="deploy-lint-summary">
        {strings.deploy.lintSummary(lint.errors, lint.warnings)}. {project?.strictMode ? strings.deploy.strictOn : strings.deploy.strictOff}
      </p>
      <div className="row-actions">
        <Btn icon={FolderCog} onClick={() => { close(); show('settings') }} testId="deploy-folders">{strings.deploy.setFolders}</Btn>
      </div>
    </div>
  )
}

const useDeployReason = (): string | undefined => {
  const project = useProject()
  const sync = useSyncState()
  return !project ? strings.deploy.noProject : !project.swfs.some((s) => !s.orphaned) ? strings.deploy.noSwfs : sync?.ffdec?.status === 'notFound' ? strings.deploy.noFfdec : undefined
}

/** Top bar Deploy dropdown (UX 4.1): exact target paths (MO2 folders; Vortex and Package Mod save a zip), scope, and the first-deploy confirmation dialog. Build All stays separate. */
export function DeployMenu() {
  const busy = useDeployStore((s) => s.busy)
  const reason = useDeployReason()
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

/** Gate rows; a row with a node closes the dialog (cancelling the deploy) and selects that layer, like a Lint dock row. */
function GateList({ items, tone, testId }: { items: DeployLintItem[]; tone: string; testId: string }) {
  const cancel = useDeployStore((s) => s.cancel)
  const fromLint = useSelectionStore((s) => s.selectFromLint)
  const project = useProject()
  const pick = (l: DeployLintItem, i: number): void => {
    const target = project?.swfs.find((s) => s.name === l.swf)
    cancel()
    if (target) useProjectStore.getState().setActiveSwf(target.id)
    fromLint({ key: `deploy|${i}`, nodeId: l.nodeId! })
  }
  return (
    <ul className="plain" data-testid={testId}>
      {items.map((l, i) => (
        <li key={i} className={tone}>
          <span className="mono">{l.code}</span>{' '}
          {l.nodeId ? (
            <button type="button" className="row-link" onClick={() => pick(l, i)} title={strings.deploy.selectLayer(l.layerName ?? l.nodeId)}>
              {l.swf ? `${l.swf} / ` : ''}{l.layerName ?? l.nodeId} <span className="dim mono">({l.nodeId})</span>
            </button>
          ) : <span className="dim">{l.swf ?? strings.deploy.project}</span>}
          : {l.message}
        </li>
      ))}
    </ul>
  )
}

/**
 * First deploy to a folder: the exact path and every file before anything is written. Also shown on every deploy the export gate blocks:
 * then it lists the blocking issues and Deploy is disabled (main refuses the commit too).
 */
export function ConfirmDialog() {
  const c = useDeployStore((s) => s.confirm)
  const accept = useDeployStore((s) => s.accept)
  const cancel = useDeployStore((s) => s.cancel)
  if (!c) return null
  const p = c.prepared
  const g = p.gate
  const blocked = !g.ok
  const notices = p.lint.filter((l) => l.severity !== 'info')
  const pkg = isPackageTarget(c.target) // a package opens this dialog only when blocked (the save dialog is its confirmation)
  return (
    <Dialog title={blocked ? (pkg ? strings.deploy.packageBlockedTitle : strings.deploy.blockedTitle) : strings.deploy.confirmTitle} onClose={cancel}>
      <div data-testid="deploy-confirm">
        {blocked && (
          <>
            <p className="tone-error" data-testid="deploy-blocked"><strong>{(pkg ? strings.deploy.packageBlockedBody : strings.deploy.blockedBody)(g.blocking.length)}</strong></p>
            <GateList items={g.blocking} tone="tone-error" testId="deploy-blocking" />
          </>
        )}
        <p className="dim" data-testid="deploy-strict">{g.strict ? strings.deploy.strictOn : strings.deploy.strictOff}</p>
        <p>{pkg ? strings.deploy.packageFolder : blocked ? strings.deploy.targetLabel : strings.deploy.confirmBody}</p>
        <p className="mono deploy-path" data-testid="deploy-confirm-path">{p.root}</p>
        {!blocked && ( // a blocked deploy's file list is partial (blocked SWFs produce none) and nothing is written
          <>
            <p><strong>{strings.deploy.confirmFiles(p.files.length)}</strong></p>
            <ul className="plain file-list mono" aria-label={strings.deploy.confirmFiles(p.files.length)}>
              {p.files.map((f) => <li key={f.rel}>{f.rel} <span className="dim">{f.size} B{f.keepExisting ? strings.deploy.keepExisting : ''}</span></li>)}
            </ul>
            {p.removed.length > 0 && <p>{strings.deploy.confirmRemoved(p.removed.length)}</p>}
          </>
        )}
        {g.warnings.length > 0 && (
          <>
            <h3>{strings.deploy.gateWarnings(g.warnings.length)}</h3>
            <GateList items={g.warnings} tone="tone-warn" testId="deploy-warnings" />
          </>
        )}
        {notices.length > 0 && (
          <>
            <h3>{strings.deploy.notices}</h3>
            <ul className="plain">{notices.map((l, i) => <li key={i} className="tone-warn"><span className="mono">{l.code}</span>: {l.message}</li>)}</ul>
          </>
        )}
        {p.notes.map((n, i) => <p key={i} className="dim">{n}</p>)}
        {!pkg && <p className="dim">{strings.deploy.confirmNote}</p>}
        <div className="row-actions">
          <Btn variant="primary" onClick={() => void accept()} reason={blocked ? strings.deploy.blockedReason(g.blocking.length) : undefined} testId="deploy-confirm-ok">{pkg ? strings.deploy.packageSave : strings.deploy.confirm}</Btn>
          <Btn onClick={cancel} testId="deploy-confirm-cancel">{strings.deploy.cancel}</Btn>
        </div>
      </div>
    </Dialog>
  )
}
