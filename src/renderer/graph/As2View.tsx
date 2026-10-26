import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { GraphAs2 } from '../../shared/graphs'
import { inkwell } from '../hooks/api'
import { highlightAs2, linesOfNode, nodeOfLine, sourceLines } from '../model/as2View'
import { toGraph, type GraphStore } from '../state/graphStore'
import { strings } from '../strings'

const DEBOUNCE_MS = 250

/**
 * The AS2 split view (UX 4.4.4): the generated class of the open graph, read-only, a `<pre>` with line numbers. The lines of the selected node are
 * highlighted through the source map; clicking a line selects its node (`onPick`, the canvas pans to it). It asks main for the code (IPC `graphAs2`,
 * codegen only, no FFDec) for the graph as it is in the editor now, debounced, so it follows edits live; the last good code stays while a request is
 * pending or failed.
 */
export function As2View({ swfName, store, selectedNode, onPick }: { swfName: string; store: GraphStore; selectedNode: string | undefined; onPick(nodeId: string): void }) {
  // a string key: selection changes (which replace the nodes array) must not regenerate the code
  const key = useStore(store, (s) => JSON.stringify(toGraph(s)))
  const [as2, setAs2] = useState<GraphAs2>()
  const [error, setError] = useState<string>()
  const seq = useRef(0)
  useEffect(() => {
    const mine = ++seq.current
    const t = setTimeout(
      () => {
        void inkwell?.graphAs2(swfName, JSON.parse(key)).then((r) => {
          if (mine !== seq.current) return
          if (r.ok) (setAs2(r.as2), setError(undefined))
          else setError(r.error)
        })
      },
      as2 ? DEBOUNCE_MS : 0
    )
    return () => clearTimeout(t)
  }, [key, swfName]) // eslint-disable-line react-hooks/exhaustive-deps
  const lines = useMemo(() => (as2 ? highlightAs2(sourceLines(as2.source)) : []), [as2])
  const mine = useMemo(() => new Set(as2 ? linesOfNode(as2.lines, selectedNode) : []), [as2, selectedNode])
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => void box.current?.querySelector('.is-hit')?.scrollIntoView({ block: 'nearest' }), [mine])
  return (
    <div className="as2-view" role="region" aria-label={strings.graph.as2Title} data-testid="as2-view" ref={box}>
      <h3>{strings.graph.as2Title}</h3>
      {error && <p className="tone-error" role="alert">{error}</p>}
      {!as2 && !error && <p className="empty">{strings.graph.as2Loading}</p>}
      {as2 && (
        <pre className="as2-code" data-testid="as2-code">
          {lines.map((text, k) => {
            const n = k + 1
            const node = nodeOfLine(as2.lines, n)
            const hit = mine.has(n)
            return (
              <div
                key={n}
                className={`as2-line${node ? ' is-mapped' : ''}${hit ? ' is-hit' : ''}`}
                onClick={node ? () => onPick(node) : undefined}
                title={node ? strings.graph.as2LineTip(node) : undefined}
                data-node={node}
              >
                <span className="as2-no" aria-hidden="true">{n}</span>
                <code>
                  {text.length ? text.map((t, i) => (t.kind === 'plain' ? t.text : <span key={i} className={`as2-${t.kind}`}>{t.text}</span>)) : ' '}
                </code>
              </div>
            )
          })}
        </pre>
      )}
      <p className="dim as2-foot">{selectedNode ? strings.graph.as2Selected(selectedNode, mine.size) : strings.graph.as2Hint}</p>
    </div>
  )
}
