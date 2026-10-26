import { useEffect, useMemo, useRef, useState } from 'react'
import { inkwell } from '../hooks/api'
import { useActiveSwf, useProject } from '../hooks/useProject'
import { usePacks } from '../hooks/usePacks'
import { defaultMenuSettings, resolveMenuNames } from '../../shared/menu'
import { reloadSummary, type DevReloadResult } from '../../shared/devLink'
import { clockTime, type TraceLevel } from '../model/traceParse'
import { sortedWatch, useDevStore, type TraceSource } from '../state/devStore'
import { findGraphStore } from '../state/graphStore'
import { graphOfNode, openGraphNode } from '../state/graphReveal'
import { useTraceStore } from '../state/traceStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Panel } from './Panel'

const TONE: Record<TraceLevel | 'text', string> = { info: '', warn: 'tone-warn', error: 'tone-error', text: 'dim' }
const GAME_TONE: Record<string, string> = { trace: 'dim', debug: 'dim', info: '', warn: 'tone-warn', error: 'tone-error' }

/**
 * Zone 6A, Runtime Trace & Watch tab (UX 4.6 Tab 3). Two sources behind a switch: the Ruffle preview's `trace()` output (docs/debugging.md) and the Game (Dev Mode, docs/dev-mode.md):
 * the lines and variables the Inkwell Runtime streams over the dev connection. A line with a node id of the active SWF's graphs selects that node (and opens its graph) in both.
 * Pin values are not lines: they appear as badges on the canvas, from the selected source. Disconnected, the game's last session stays visible, greyed out.
 */
export function TracePanel() {
  const swf = useActiveSwf()
  const project = useProject()
  const defs = usePacks()
  const ruffle = useTraceStore((s) => s.lines)
  const clearRuffle = useTraceStore((s) => s.clear)
  const source = useDevStore((s) => s.source)
  const setSource = useDevStore((s) => s.setSource)
  const dev = useDevStore((s) => s.dev)
  const gameLines = useDevStore((s) => s.lines)
  const watch = useDevStore((s) => s.watch)
  const seen = useDevStore((s) => s.seen)
  const clearGame = useDevStore((s) => s.clear)
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [reload, setReload] = useState<{ busy: boolean; text?: string; bad?: boolean }>({ busy: false })
  const end = useRef<HTMLDivElement>(null)
  const game = source === 'game'
  const connected = dev.phase === 'connected'
  const greyed = game && !connected
  const lines = game ? gameLines : ruffle
  const rows = useMemo(() => {
    if (game) return gameLines.filter((l) => !errorsOnly || l.level === 'warn' || l.level === 'error')
    return ruffle.filter((l) => !errorsOnly || (l.line.kind === 'log' && l.line.level !== 'info'))
  }, [game, gameLines, ruffle, errorsOnly])
  useEffect(() => void end.current?.scrollIntoView({ block: 'nearest' }), [rows.length])
  /** Which graph and what kind of node a line talks about (undefined: not a node of the active SWF). */
  const locate = (node: string): { graph: string; title: string } | undefined => {
    const g = swf && graphOfNode(swf.id, node)
    const n = g && swf ? findGraphStore(swf.id, g)?.getState().nodes.find((x) => x.id === node) : undefined
    return g && n ? { graph: g, title: defs.get(n.data.kind)?.title ?? n.data.kind } : undefined
  }
  const open = (node: string): void => {
    const hit = locate(node)
    if (hit && swf) openGraphNode({ swfName: swf.name, graph: hit.graph, node })
  }
  /** The menu of the active SWF as the game knows it (menu JSON `name`), when the SWF is a custom menu. */
  const menuName = swf && project && swf.ir.target.kind === 'customMenu' ? resolveMenuNames(project.modId, { swf: swf.name, settings: swf.menu ?? defaultMenuSettings() }).name : undefined
  const triggerReload = async (): Promise<void> => {
    if (!inkwell || reload.busy) return
    setReload({ busy: true, text: strings.dev.reloading })
    const r: DevReloadResult = await inkwell.devReload(menuName)
    setReload({ busy: false, text: reloadSummary(r), bad: !r.ok })
  }
  const reloadReason = !connected ? strings.dev.reloadNeedsGame : reload.busy ? strings.dev.reloading : undefined
  const clear = (): void => (game ? clearGame() : clearRuffle())
  const watchRows = sortedWatch(watch)
  const switchTo = (s: TraceSource): void => setSource(s)
  return (
    <Panel title={strings.trace.title}>
      <div className="toolbar trace-toolbar">
        <span className="seg" role="radiogroup" aria-label={strings.dev.sourceLabel} data-testid="trace-source">
          <button type="button" role="radio" aria-checked={!game} className="btn btn-seg" onClick={() => switchTo('ruffle')} data-testid="source-ruffle">{strings.dev.sourceRuffle}</button>
          <button type="button" role="radio" aria-checked={game} className="btn btn-seg" onClick={() => switchTo('game')} data-testid="source-game">{strings.dev.sourceGame}</button>
        </span>
        {game && (
          <span className={`chip ${connected ? 'chip-ok' : ''}`} data-testid="trace-conn">
            <span className={`dot dot-${connected ? (dev.specMismatch ? 'warn' : 'ok') : 'off'}`} aria-hidden="true" />{' '}
            {connected ? strings.dev.connectedTip(dev.runtime?.versionString ?? '?', dev.port) : strings.dev.phase[dev.phase]}
          </span>
        )}
        <label><input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} /> {strings.trace.errorsOnly}</label>
        <span className="push-right row-actions">
          <Btn onClick={() => void triggerReload()} reason={reloadReason} testId="trace-reload">{strings.trace.hotReload}</Btn>
          <Btn onClick={clear} testId="trace-clear" reason={lines.length ? undefined : strings.trace.nothingToClear}>{strings.trace.clear}</Btn>
        </span>
      </div>
      <p className="dim" data-testid="trace-notice">{game ? strings.dev.gameNotice : strings.trace.notice}</p>
      {reload.text && <p className={reload.bad ? 'tone-error' : 'dim'} data-testid="reload-result" role="status">{reload.text}</p>}
      {greyed && seen && <p className="dim" data-testid="trace-greyed">{strings.dev.greyedNote}</p>}
      <div className="trace">
        <section aria-label={strings.trace.live} className={greyed ? 'is-greyed' : undefined} data-testid="trace-live">
          <h3>{strings.trace.live}</h3>
          {game && !seen && !connected ? (
            <p className="empty" data-testid="trace-empty-game">{strings.trace.start}</p>
          ) : rows.length === 0 ? (
            <p className="empty">{game ? strings.trace.emptyGame : project ? strings.trace.empty : strings.trace.start}</p>
          ) : game ? (
            <ol className="trace-lines" data-testid="trace-lines">
              {(rows as typeof gameLines).map((l) => {
                const hit = l.node ? locate(l.node) : undefined
                return (
                  <li key={l.id} className={`trace-line ${GAME_TONE[l.level]}${hit ? ' is-link' : ''}`} onClick={hit && l.node ? () => open(l.node!) : undefined} data-node={l.node} title={hit ? strings.trace.select(hit.title) : undefined}>
                    <span className="mono dim">[{clockTime(l.at)}]</span>{' '}
                    <span className="mono">{l.level.toUpperCase()}</span>{' '}
                    {!l.note && <span className="mono dim">{strings.dev.gameLine(l.source)}{l.menu ? ` ${l.menu}` : ''}</span>}{' '}
                    {l.node && <span className="mono">{hit ? `${hit.title} ` : ''}#{l.node}</span>}{' '}
                    <span>{l.text}</span>
                  </li>
                )
              })}
              <div ref={end} />
            </ol>
          ) : (
            <ol className="trace-lines" data-testid="trace-lines">
              {(rows as typeof ruffle).map(({ id, at, line }) => {
                const hit = line.kind === 'log' ? locate(line.node) : undefined
                const level = line.kind === 'log' ? line.level : 'text'
                return (
                  <li key={id} className={`trace-line ${TONE[level]}${hit ? ' is-link' : ''}`} onClick={line.kind === 'log' && hit ? () => open(line.node) : undefined} data-node={line.kind === 'log' ? line.node : undefined} title={hit ? strings.trace.select(hit.title) : undefined}>
                    <span className="mono dim">[{clockTime(at)}]</span>{' '}
                    <span className="mono">{level === 'text' ? 'TRACE' : level.toUpperCase()}</span>{' '}
                    {line.kind === 'log' && <span className="mono">{hit ? `${hit.title} ` : ''}#{line.node}</span>}{' '}
                    <span>{line.kind === 'pin' ? '' : line.message}</span>
                  </li>
                )
              })}
              <div ref={end} />
            </ol>
          )}
        </section>
        <section aria-label={strings.trace.watch} className={game ? (greyed ? 'is-greyed' : undefined) : 'is-greyed'} data-testid="trace-watch">
          <h3>{strings.trace.watch}</h3>
          {!game ? (
            <p className="empty">{strings.trace.watchLater}</p>
          ) : watchRows.length === 0 ? (
            <p className="empty">{strings.dev.watchEmpty}</p>
          ) : (
            <table className="watch-table" data-testid="watch-table">
              <thead><tr>{strings.trace.watchCols.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
              <tbody>
                {watchRows.map((w) => (
                  <tr key={w.key} title={strings.dev.watchTip(w.menu, w.graph)}>
                    <td>{strings.dev.watchScope[w.scope]}</td><td className="mono">{w.name}</td><td className="mono">{w.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </Panel>
  )
}
