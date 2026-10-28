import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { incoming, outgoing, parseNodeStatus } from '@nicklaj/knotwork'
import { CircleX, TriangleAlert, Zap } from 'lucide-react'
import { createContext, memo, useContext } from 'react'
import { useStore } from 'zustand'
import type { Graph, NodeDef } from '@inkwell-ui/spec'
import { categoryVar, fieldRows, nodePins, PIN_STYLE, type FieldRow, type LayerOption } from '../model/graphModel'
import { functionChoices, inHandle, outHandle, pinName, pointCall, type FlowNode, type GraphStore } from '../state/graphStore'
import type { createGraphValidation } from '../state/graphValidation'
import { usePinBadge } from '../state/devStore'
import { useRunCount, useTraceStore } from '../state/traceStore'
import { strings } from '../strings'
import { FieldEditor } from './FieldEditors'

/** Everything a node needs from the canvas, by context so the node components stay memoized on their own props. */
export interface GraphCtx {
  store: GraphStore
  defs: ReadonlyMap<string, NodeDef>
  layers: readonly LayerOption[]
  variables: Graph['variables']
  /** The signature of the open graph when it is a function (Function Entry and Exit take their pins from it). */
  signature: Graph['signature']
  issues: ReturnType<typeof createGraphValidation>['use']
}
export const GraphContext = createContext<GraphCtx | undefined>(undefined)
const useCtx = (): GraphCtx => useContext(GraphContext)!

const pinLabel = (p: { name: string; type: string }, def: NodeDef | undefined, side: 'inputs' | 'outputs'): string =>
  ((def?.[side].find((x) => x.name === p.name) as { label?: string } | undefined)?.label) ?? p.name

/** The progress of a timer node (Delay) armed in the preview: the fill grows over its duration and goes when the continuation ran or Cancel Delay cleared it. shortcut: it follows the clock, not the movie, so a paused preview keeps filling. */
function TimerBar({ node }: { node: string }) {
  const w = useTraceStore((s) => s.waits[node])
  return (
    <div className="gn-timer" aria-hidden="true">
      {w?.state === 'running' && <span key={w.n} className="gn-timer-fill" style={{ animationDuration: `${w.ms}ms` }} />}
    </div>
  )
}

function Pin({ side, name, type, label, bad, node }: { side: 'in' | 'out'; name: string; type: keyof typeof PIN_STYLE | 'unknown'; label: string; bad?: boolean; node?: string }) {
  const style = type === 'unknown' ? undefined : PIN_STYLE[type]
  // last value of this output: from the Ruffle preview's trace, or (Trace & Watch source Game) streamed by the game (docs/debugging.md, docs/dev-mode.md)
  const badge = usePinBadge(side === 'out' && node ? node : '', name)
  const value = badge?.value
  return (
    <div className={`gn-pin-head gn-${side}${bad ? ' is-bad' : ''}`} title={`${label}: ${type}`}>
      <Handle
        type={side === 'in' ? 'target' : 'source'}
        position={side === 'in' ? Position.Left : Position.Right}
        id={side === 'in' ? inHandle(name) : outHandle(name)}
        className="gn-handle"
        {...{ 'data-pin': type, 'data-shape': style?.shape ?? 'unknown' }}
        style={style ? { color: style.color } : undefined}
      />
      {value !== undefined && <span className={`gn-pin-val mono${badge?.game ? ' is-game' : ''}`} title={badge?.game ? strings.dev.pinGameTip(value) : strings.graph.pinValueTip(value)} data-testid="pin-value" data-source={badge?.game ? 'game' : 'preview'}>{value.length > 24 ? `${value.slice(0, 23)}…` : value}</span>}
      <span className="gn-pin-label">{label}{type !== 'unknown' && ['Text', 'Button', 'List', 'Image', 'Clip'].includes(type) ? <span className="gn-pin-type"> {type}</span> : null}</span>
    </div>
  )
}

/** Input pins with a wire, as a primitive so a node re-renders only when its own wiring changes. */
const wiredKey = (edges: Parameters<typeof incoming>[0], id: string): string => incoming(edges, id).map((e) => pinName(e.targetHandle)).join(',')

function InkwellNodeView({ id, data, selected }: NodeProps<FlowNode>) {
  const ctx = useCtx()
  const def = ctx.defs.get(data.kind)
  const status = parseNodeStatus(ctx.issues((s) => s.byNode[id]))
  const badPins = ctx.issues((s) => s.pinsByNode[id])
  const ran = useRunCount(id) // an exec node of the preview ran this often since the last build: a flash on every run, a mark after
  const wired = useStore(ctx.store, (s) => wiredKey(s.edges, id))
  const outs = useStore(ctx.store, (s) => outgoing(s.edges, id).map((e) => pinName(e.sourceHandle)).join(','))
  const bad = new Set(badPins ? badPins.split(',') : [])
  const callKey = (def?.extra as { callsFunction?: string } | undefined)?.callsFunction
  // choosing the function of a Call Function node also copies its signature and re-points the wires
  const setField = (key: string, value: unknown): void => (key === callKey && typeof value === 'string' ? pointCall(ctx.store, id, value) : ctx.store.getState().setField(id, key, value))
  const fctx = { setField, layers: ctx.layers, variables: ctx.variables, badPins: bad }

  if (!def) {
    // Unknown pack node (UX 4.4.6): striped header, its wires keep their handles, fields stay untouched in the file.
    const ins = [...new Set(wired.split(',').filter(Boolean))]
    const outsList = [...new Set(outs.split(',').filter(Boolean))]
    return (
      <div className={`gn gn-unknown${selected ? ' is-selected' : ''}`} data-status="error" data-testid="node-unknown">
        <div className="gn-head gn-head-unknown"><TriangleAlert size={13} aria-hidden="true" /><span className="gn-title">{strings.graph.unknownNode}</span></div>
        <div className="gn-sub mono">{data.kind}</div>
        <div className="gn-pins">
          <div className="gn-col">{ins.map((n) => <Pin key={n} side="in" name={n} type="unknown" label={n} />)}</div>
          <div className="gn-col gn-col-out">{outsList.map((n) => <Pin key={n} side="out" name={n} type="unknown" label={n} />)}</div>
        </div>
      </div>
    )
  }

  const kind = def.kind
  if (kind === 'Reroute') {
    return (
      <div className={`gn gn-reroute${selected ? ' is-selected' : ''}`} title={strings.graph.reroute}>
        <Pin side="in" name="in" type="String" label="" />
        <Pin side="out" name="out" type="String" label="" />
      </div>
    )
  }
  const pins = nodePins(ctx.defs, { data }, ctx.variables, ctx.signature)!
  if (kind === 'Comment') {
    return (
      <div className={`gn gn-comment${selected ? ' is-selected' : ''}`}>
        <div className="gn-head"><span className="gn-title">{def.title}</span></div>
        <FieldEditor row={{ key: 'text', label: 'text', kind: 'text', value: data.fields['text'] }} ctx={fctx} bare />
      </div>
    )
  }
  if (kind === 'Group') {
    const w = typeof data.fields['w'] === 'number' ? data.fields['w'] : 320
    const h = typeof data.fields['h'] === 'number' ? data.fields['h'] : 180
    return (
      <div className={`gn gn-group${selected ? ' is-selected' : ''}`} style={{ width: w, height: h }}>
        <NodeResizer isVisible={selected} minWidth={160} minHeight={80} onResizeEnd={(_e, p) => (setField('w', Math.round(p.width)), setField('h', Math.round(p.height)))} />
        <FieldEditor row={{ key: 'name', label: 'name', kind: 'string', value: data.fields['name'] }} ctx={fctx} bare />
      </div>
    )
  }

  const rows = fieldRows(def, { data }, pins, new Set(wired.split(',')), { sig: ctx.signature, functions: callKey ? functionChoices(ctx.store) : [] })
  const rowOf = new Map(rows.map((r) => [r.key, r]))
  const pinRows = (list: typeof pins.inputs, side: 'inputs'): React.ReactNode =>
    list.map((p) => {
      const row: FieldRow | undefined = p.type === 'Exec' ? undefined : rowOf.get(p.name)
      return (
        <div key={p.name} className="gn-pin">
          <Pin side="in" name={p.name} type={p.type} label={pinLabel(p, def, side)} bad={bad.has(p.name)} />
          {row && <div className="gn-inline"><FieldEditor row={row} ctx={fctx} bare /></div>}
        </div>
      )
    })
  const pinNames = new Set(pins.inputs.map((p) => p.name))
  const entry = (def.extra as { entry?: boolean } | undefined)?.entry === true
  const volatile = (def.extra as { volatile?: boolean } | undefined)?.volatile === true
  const own = rows.filter((r) => !pinNames.has(r.key))
  return (
    <div className={`gn${selected ? ' is-selected' : ''}${ran ? ' has-run' : ''}`} data-status={status.level ?? 'ok'} data-testid={`node-${data.kind}`} style={{ ['--gn-accent' as string]: categoryVar(def.category) }}>
      {ran > 0 && <span key={ran} className="gn-run" aria-hidden="true" />}
      <div className="gn-head">
        {entry && <Zap size={13} aria-hidden="true" />}
        <span className="gn-title">{def.title}</span>
        {def.pure && <span className="gn-tag" title={volatile ? strings.graph.pureLiveTip : strings.graph.pureTip}>{volatile ? strings.graph.pureLive : strings.graph.pureCached}</span>}
        {status.level && (
          <span className={`gn-badge is-${status.level}`} role="img" aria-label={`${status.level}: ${status.messages.join(' ')}`} title={status.messages.join('\n')} data-testid="node-badge">
            {status.level === 'error' ? <CircleX size={13} aria-hidden="true" /> : <TriangleAlert size={13} aria-hidden="true" />}
          </span>
        )}
      </div>
      {(def.extra as { timer?: string } | undefined)?.timer && <TimerBar node={id} />}
      <div className="gn-pins">
        <div className="gn-col">{pinRows(pins.inputs, 'inputs')}</div>
        <div className="gn-col gn-col-out">
          {pins.outputs.map((p) => <Pin key={p.name} side="out" name={p.name} type={p.type} label={pinLabel(p, def, 'outputs')} node={id} />)}
        </div>
      </div>
      {own.length > 0 && (
        <div className="gn-fields">{own.map((r) => <FieldEditor key={r.key} row={r} ctx={fctx} />)}</div>
      )}
    </div>
  )
}
export const InkwellNode = memo(InkwellNodeView)
