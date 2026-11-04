import { useEffect, useMemo, useRef, useState } from 'react'
import { COMMANDS, type CommandId } from '../../shared/commands'
import { fuzzyScore } from '../../shared/filter'
import { strings } from '../../shared/strings'
import { useSwfGraphs } from '../hooks/useGraphs'
import { useProject } from '../hooks/useProject'
import { useDialogStore } from '../state/dialogStore'
import { setActiveGraph } from '../state/graphDocs'
import { findGraphStore } from '../state/graphStore'
import { useProjectStore } from '../state/projectStore'
import { runCommand } from '../state/runCommand'
import { Dialog } from '../ui/Dialog'
import { SearchBox } from '../ui/SearchBox'

interface Item { key: string; label: string; keys?: string; run(): void }

/** Ctrl+K: the commands of `shared/commands.ts` plus the open project's SWFs and the active SWF's graphs, filtered by `fuzzyScore`; arrows move, Enter runs, Esc closes. */
export function CommandPalette() {
  const project = useProject()
  const { ids } = useSwfGraphs()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const close = useDialogStore((s) => s.close)
  const root = useRef<HTMLDivElement>(null)
  // autoFocus alone loses to the dialog taking focus (and to a menu accelerator returning it to the page), so arrows work from the first key
  useEffect(() => {
    const focus = (): void => root.current?.querySelector('input')?.focus()
    focus()
    const raf = requestAnimationFrame(focus)
    return () => cancelAnimationFrame(raf)
  }, [])
  const activeId = useProjectStore((s) => s.activeSwfId)
  const items = useMemo(() => {
    const hasMenu = !!project?.swfs.some((s) => !s.orphaned && s.ir.target.kind === 'customMenu')
    const cmds = COMMANDS.filter((c) => (project || !c.needsProject) && (c.id !== 'devDeploy' || hasMenu)).map((c): Item => ({ key: c.id, label: c.label, ...(c.keys ? { keys: c.keys } : {}), run: () => runCommand(c.id as CommandId) }))
    const swfs = (project?.swfs ?? []).filter((s) => !s.orphaned && s.id !== activeId).map((s): Item => ({ key: `swf:${s.id}`, label: strings.cmd.switchSwf(s.name), run: () => useProjectStore.getState().setActiveSwf(s.id) }))
    const graphs = ids.flatMap((id): Item[] => {
      const g = activeId ? findGraphStore(activeId, id)?.getState() : undefined
      return g && activeId ? [{ key: `graph:${id}`, label: strings.cmd.goToGraph(g.name), run: () => setActiveGraph(activeId, id) }] : []
    })
    // an empty field shows the commands only; SWFs and graphs join once the user types
    return query.trim() ? [...cmds, ...swfs, ...graphs] : cmds
  }, [project, ids, activeId, query])
  const shown = useMemo(
    () => items.flatMap((i) => { const s = fuzzyScore(query, i.label); return s === undefined ? [] : [{ i, s }] }).sort((a, b) => a.s - b.s).map((x) => x.i),
    [items, query]
  )
  const at = Math.min(cursor, shown.length - 1)
  const pick = (i: Item | undefined): void => {
    if (!i) return
    close() // first, so a command that opens a dialog is not closed by it
    i.run()
  }
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((at + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(1, shown.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(shown[at])
    }
  }
  return (
    <Dialog title={strings.cmd.palette} onClose={close} bare>
      <div ref={root} className="cmd" onKeyDown={onKey} data-testid="command-palette">
        <SearchBox value={query} onChange={(v) => (setQuery(v), setCursor(0))} label={strings.cmd.placeholder} testId="command-input" autoFocus />
        <ul className="cmd-list" role="listbox" aria-label={strings.cmd.list}>
          {shown.map((i, n) => (
            <li key={i.key} role="option" aria-selected={n === at} ref={(el) => { if (n === at) el?.scrollIntoView({ block: 'nearest' }) }}>
              <button type="button" tabIndex={-1} className={n === at ? 'is-selected' : undefined} onClick={() => pick(i)} onMouseMove={() => setCursor(n)}>
                <span>{i.label}</span>
                {i.keys && <kbd>{i.keys}</kbd>}
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="empty">{strings.cmd.empty}</li>}
        </ul>
      </div>
    </Dialog>
  )
}
