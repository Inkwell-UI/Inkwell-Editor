
import { useEffect } from 'react'
import { ChevronDown, Hammer, Settings2, FileStack } from 'lucide-react'
import { inkwell } from '../hooks/api'
import { useActiveSwf, useProject } from '../hooks/useProject'
import { useSyncState } from '../hooks/useSyncState'
import { useDialogStore } from '../state/dialogStore'
import { useProjectStore } from '../state/projectStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Popover } from '../ui/Popover'
import { WORKSPACE_IDS } from '../workspace/workspaces'
import { DeployMenu } from './DeployMenu'

function SwfSwitcher() {
  const project = useProject()
  const active = useActiveSwf()
  const swfs = project?.swfs ?? []
  const live = swfs.filter((s) => !s.orphaned)
  const orphaned = swfs.filter((s) => s.orphaned)
  const setActive = useProjectStore((s) => s.setActiveSwf)
  return (
    <Popover
      label={strings.top.swfList}
      trigger={(p, open) => (
        <button type="button" className="btn btn-select" {...p} data-testid="swf-switcher" title={strings.top.swf} aria-label={`${strings.top.swf}: ${active?.name ?? strings.top.noSwf}`}>
          <FileStack size={14} aria-hidden="true" />
          <span className="btn-label">{active?.name ?? strings.top.noSwf}</span>
          <ChevronDown size={14} aria-hidden="true" className={open ? 'flip' : undefined} />
        </button>
      )}
    >
      {(close) => (
        <ul className="menu" role="listbox" aria-label={strings.top.swfList}>
          {live.length === 0 && orphaned.length === 0 && <li className="empty">{strings.top.noSwfs}</li>}
          {live.map((s) => (
            <li key={s.id} role="option" aria-selected={s.id === active?.id}>
              <button type="button" className={s.id === active?.id ? 'is-selected' : undefined} onClick={() => { setActive(s.id); close() }}>{s.name}</button>
            </li>
          ))}
          {orphaned.length > 0 && (
            <>
              <li role="separator" className="menu-divider">{strings.top.orphanedDivider}</li>
              {orphaned.map((s) => (
                <li key={s.id} role="option" aria-selected={s.id === active?.id}>
                  <button type="button" className={s.id === active?.id ? 'is-selected' : undefined} onClick={() => { setActive(s.id); close() }}>{s.name} <span className="dim">{strings.top.orphanedTag}</span></button>
                </li>
              ))}
            </>
          )}
        </ul>
      )}
    </Popover>
  )
}

function WorkspaceSwitcher() {
  const active = useWorkspaceStore((s) => s.active)
  const setActive = useWorkspaceStore((s) => s.setActive)
  const onKey = (e: React.KeyboardEvent): void => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const next = WORKSPACE_IDS[(WORKSPACE_IDS.indexOf(active) + d + WORKSPACE_IDS.length) % WORKSPACE_IDS.length]!
    setActive(next)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-workspace="${next}"]`)?.focus())
  }
  return (
    <div className="seg" role="radiogroup" aria-label={strings.top.workspaces} onKeyDown={onKey}>
      {WORKSPACE_IDS.map((id, i) => (
        <button key={id} type="button" role="radio" aria-checked={active === id} tabIndex={active === id ? 0 : -1} className="btn btn-seg" data-workspace={id} data-testid={`workspace-${id}`} onClick={() => setActive(id)} title={strings.top.workspaceTip(id, i + 1)}>
          {strings.top.workspaceNames[id]} <kbd>{i + 1}</kbd>
        </button>
      ))}
    </div>
  )
}

/** Zone 1 (UX 4.1): project, SWF switcher, target pill, workspace switcher, Setup, Build All and Deploy (which also packages). */
export function TopBar() {
  const project = useProject()
  const swf = useActiveSwf()
  const sync = useSyncState()
  const show = useDialogStore((s) => s.show)
  useEffect(() => { document.title = strings.windowTitleFor(project?.name) }, [project?.name])
  const compiling = sync?.build === 'compiling'
  const buildReason =
    sync?.ffdec?.status === 'notFound' ? strings.top.buildNoFfdec : !project?.swfs.some((s) => !s.orphaned) ? strings.top.buildNoSwfs : undefined
  return (
    <header className="topbar" aria-label={strings.top.label}>
      <SwfSwitcher />
      <Btn icon={Settings2} onClick={() => show('configOwnership')} label={strings.top.targetLabel(swf?.ir.target.kind)} testId="target-pill" className="btn-pill">
        {swf ? strings.top.kindNames[swf.ir.target.kind] : strings.top.noTarget}
      </Btn>
      <WorkspaceSwitcher />
      <span className="spacer" />
      <Btn icon={Hammer} variant="primary" onClick={() => void inkwell?.buildAll()} reason={buildReason} testId="build-all">{compiling ? strings.top.building : strings.top.buildAll}</Btn>
      <DeployMenu />
    </header>
  )
}
