import { useEffect, useMemo, useRef, useState } from 'react'
import { useActiveSwf, useProject } from '../hooks/useProject'
import { usePacks } from '../hooks/usePacks'
import { clockTime, type TraceLevel } from '../model/traceParse'
import { findGraphStore } from '../state/graphStore'
import { graphOfNode, openGraphNode } from '../state/graphReveal'
import { useTraceStore } from '../state/traceStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Panel } from './Panel'

const TONE: Record<TraceLevel | 'text', string> = { info: '', warn: 'tone-warn', error: 'tone-error', text: 'dim' }

/**
 * Zone 6A, Runtime Trace tab (UX 4.6). Shows the `trace()` output of the Ruffle preview (docs/debugging.md): the Log node lines and handler failures
 * with time, level, node and message; a line with a node id of the active SWF's graphs selects that node (and opens its graph). Pin values are not lines:
 * they appear as badges on the canvas. The game connection and the variable watch need the runtime (0.3) and stay greyed.
 */
export function TracePanel() {
  const swf = useActiveSwf()
  const project = useProject()
  const defs = usePacks()
  const lines = useTraceStore((s) => s.lines)
  const clear = useTraceStore((s) => s.clear)
  const [errorsOnly, setErrorsOnly] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const shown = useMemo(() => lines.filter((l) => !errorsOnly || (l.line.kind === 'log' && l.line.level !== 'info')), [lines, errorsOnly])
  useEffect(() => void end.current?.scrollIntoView({ block: 'nearest' }), [shown.length])
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
  return (
    <Panel title={strings.trace.title}>
      <div className="toolbar">
        <span className="chip" data-testid="trace-source">{strings.trace.source}</span>
        <label><input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} /> {strings.trace.errorsOnly}</label>
        <span className="push-right row-actions">
          <Btn reason={strings.trace.later}>{strings.trace.hotReload}</Btn>
          <Btn onClick={clear} testId="trace-clear" reason={lines.length ? undefined : strings.trace.nothingToClear}>{strings.trace.clear}</Btn>
        </span>
      </div>
      <p className="dim" data-testid="trace-notice">{strings.trace.notice}</p>
      <div className="trace">
        <section aria-label={strings.trace.live}>
          <h3>{strings.trace.live}</h3>
          {shown.length === 0 ? (
            <p className="empty">{project ? strings.trace.empty : strings.trace.start}</p>
          ) : (
            <ol className="trace-lines" data-testid="trace-lines">
              {shown.map(({ id, at, line }) => {
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
        <section aria-label={strings.trace.watch} className="is-greyed">
          <h3>{strings.trace.watch}</h3>
          <p className="empty">{strings.trace.watchLater}</p>
        </section>
      </div>
    </Panel>
  )
}
