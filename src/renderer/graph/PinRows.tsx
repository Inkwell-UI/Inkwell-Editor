import { ArrowUpRight, FlaskConical, Link, TriangleAlert, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { pinCompat, type NodeDef, type PinType } from '@inkwell-ui/spec'
import { BIND_NAME, mockDataOf, withMockData, type MockValue } from '../../shared/graphBinding'
import { isMockPinType, pinMocksOf } from '../../shared/pinMock'
import { useActiveOverlay } from '../hooks/useProject'
import { PIN_STYLE, humanize, inspectorText, isComponentType, pinDefault, type FieldRow } from '../model/graphModel'
import { mockType } from '../model/variables'
import { editOverlay } from '../state/overlayStore'
import { useSelectionStore } from '../state/selectionStore'
import type { FlowEdge, FlowNode, GraphState } from '../state/graphStore'
import { pinName } from '../state/graphStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Popover } from '../ui/Popover'
import { FieldEditor, type FieldCtx } from './FieldEditors'

type Pin = { name: string; type: string }

/** What the pin rows of the Inspector read from the open graph. */
export interface PinRowsProps {
  swfId: string
  graphId: string | undefined
  store: { getState(): GraphState }
  node: FlowNode
  def: NodeDef
  defs: ReadonlyMap<string, NodeDef>
  nodes: readonly FlowNode[]
  edges: readonly FlowEdge[]
  inputs: readonly Pin[]
  outputs: readonly Pin[]
  /** The inline editors of the node (`fieldRows`): unwired data inputs and the pack's own fields. */
  rows: readonly FieldRow[]
  /** `ctx.variables` are the variables the open graph can read. */
  ctx: FieldCtx
}

const pinLabel = (def: NodeDef, name: string, side: 'inputs' | 'outputs'): string =>
  inspectorText(def).labels?.[name] ?? (def[side].find((p) => p.name === name) as { label?: string } | undefined)?.label ?? humanize(name)

const dot = (type: string): string => PIN_STYLE[type as keyof typeof PIN_STYLE]?.color ?? 'var(--fg-dim)'

/** One wire as a row: where it comes from or goes to, with a button that selects that node. */
function WireRow({ type, text, target, p }: { type: string; text: string; target: FlowNode | undefined; p: PinRowsProps }) {
  const title = target ? p.defs.get(target.data.kind)?.title ?? target.data.kind : ''
  return (
    <div className="pinrow-wire">
      <span className="pinrow-dot" style={{ background: dot(type) }} aria-hidden="true" />
      <span className="pinrow-wire-text">{text}</span>
      {target && p.graphId && <Btn icon={ArrowUpRight} label={strings.insp.gnGoTo(title)} variant="quiet" onClick={() => useSelectionStore.getState().revealGraphNode(p.graphId!, target.id)} />}
    </div>
  )
}

const NotConnected = () => <div className="pinrow-wire pinrow-none"><span className="pinrow-wire-text">{strings.insp.gnNotConnected}</span></div>

/** The filled box of a bound input, the same look as a bound layer property in the Data section (`BindingRows`), with a link icon for a variable and a flask for mock data. */
function BoundBox({ name, type, preview, note }: { name: string; type?: string | undefined; preview: boolean; note?: string | undefined }) {
  const Icon = preview ? FlaskConical : Link
  return (
    <span className="bindfld-value is-bound" title={preview ? strings.pinMock.previewOnlyHelp : undefined}>
      <Icon size={14} className="pinrow-ico" aria-hidden="true" />
      <b>{name}</b>
      {type && <span className="dim">{type}</span>}
      {preview && <span className="chip chip-warn">{strings.bind.previewOnly}</span>}
      {note && <span className="tone-warn bindfld-warn" role="img" aria-label={note} title={note}><TriangleAlert size={13} aria-hidden="true" /></span>}
    </span>
  )
}

/**
 * Wraps the value of one data input (its field or its wire row) with the link button, the same control and look as the layer Data section (`BindingRows`).
 * The popover offers graph variables, and mock data for String, Number and Bool inputs (the types a mock field has).
 * - A variable binding is a real wire from a Get Variable node (`bindInput`), so codegen, lint and the canvas see an ordinary wire; its box has no chip.
 * - A mock binding is the preview-only link of `extra.pinMock`; its box carries the "Preview only" chip. `ignored` names the wire the preview skips while it is set.
 * An input wired from any other node offers mock data only (a variable would replace that wire); components pins pick a layer and have no button.
 */
function BindInput({ p, pin, slot, seed, wire, children }: { p: PinRowsProps; pin: Pin; slot: number; seed: unknown; wire: { text: string; variable: boolean; source: FlowNode } | undefined; children: ReactNode }) {
  const overlay = useActiveOverlay()
  if (isComponentType(pin.type as PinType)) return <>{children}</>
  const label = pinLabel(p.def, pin.name, 'inputs')
  const data = mockDataOf(overlay)
  const mockable = isMockPinType(pin.type)
  const mockKey = mockable ? pinMocksOf(p.node.data.extra)[pin.name] : undefined
  const getVariable = [...p.defs].find(([k, d]) => k.startsWith('core/') && d.kind === 'GetVariable')?.[0]
  const bound = wire?.variable ? p.ctx.variables.find((v) => v.id === wire.source.data.fields['variable']) : undefined
  // the Get Variable node that feeds this input and nothing else is removed with the binding
  const soleUse = (src: FlowNode): string | undefined => (p.edges.filter((e) => e.source === src.id).length === 1 ? src.id : undefined)
  const setMock = (next: string | undefined): void => p.store.getState().setPinMock(p.node.id, pin.name, next)

  if (mockKey !== undefined) {
    const mocked = data[mockKey]
    const type = mocked === undefined ? undefined : mockType(mocked)
    const note = type === undefined ? strings.bind.missing(mockKey) : type !== pin.type ? strings.pinMock.typeNote(label, type) : undefined
    return (
      <>
        <div className="pinrow-line">
          <BoundBox name={mockKey} type={type} preview note={note} />
          <Btn icon={X} label={strings.pinMock.unlink(label)} variant="quiet" className="btn-hover-err" onClick={() => setMock(undefined)} />
        </div>
        {wire && <p className="pinrow-hint">{strings.pinMock.wireIgnored(wire.text)}</p>}
      </>
    )
  }
  if (wire?.variable) {
    const name = bound?.name ?? String(wire.source.data.fields['variable'] ?? '')
    const note = bound === undefined ? strings.bind.missing(name) : pinCompat(bound.type as PinType, pin.type as PinType) === 'none' ? strings.pinMock.typeNote(label, bound.type) : undefined
    return (
      <div className="pinrow-line">
        <BoundBox name={name} type={bound?.type} preview={false} note={note} />
        <Btn icon={X} label={strings.pinMock.unlinkVariable(label)} variant="quiet" className="btn-hover-err" onClick={() => p.store.getState().bindInput(p.node.id, pin.name, undefined, soleUse(wire.source))} />
      </div>
    )
  }

  const vars = wire || !getVariable ? [] : p.ctx.variables.filter((v) => pinCompat(v.type as PinType, pin.type as PinType) !== 'none')
  const fits = mockable ? Object.entries(data).filter(([, m]) => mockType(m) === pin.type) : []
  if (!mockable && vars.length === 0) return <>{children}</>
  const bind = (variable: string): void => p.store.getState().bindInput(p.node.id, pin.name, { id: crypto.randomUUID(), kind: getVariable!, variable, slot })
  const create = (): void => {
    const base = pin.name.replace(/[^A-Za-z0-9_.-]/g, '_') || 'value'
    let k = base
    for (let n = 2; Object.hasOwn(data, k) || !BIND_NAME.test(k); n++) k = `${base}${n}`
    const value: MockValue = pin.type === 'Number' ? Number(seed) || 0 : pin.type === 'Bool' ? seed === true : typeof seed === 'string' ? seed : ''
    editOverlay(p.swfId, (doc) => withMockData(doc, { ...mockDataOf(doc), [k]: value }))
    setMock(k)
  }
  return (
    <div className="pinrow-line">
      <div className="pinrow-main">{children}</div>
      <Popover
        align="end"
        label={strings.pinMock.popTitle(label)}
        className="bindfld-pop"
        trigger={(t) => <Btn icon={Link} label={strings.pinMock.link(label, mockable)} variant="quiet" expanded={t['aria-expanded']} haspopup="dialog" onClick={t.onClick} />}
      >
        {(close) => (
          <div className="bindfld-list">
            {vars.length > 0 && (
              <>
                <h4 className="bindfld-group">{strings.bind.variables}</h4>
                <ul className="plain menu">
                  {vars.map((v) => <li key={v.id}><button type="button" className="pinrow-opt" onClick={() => { bind(v.id); close() }}><Link size={14} className="pinrow-ico" aria-hidden="true" />{v.name} <span className="dim">{v.type}</span></button></li>)}
                </ul>
              </>
            )}
            {mockable && (
              <>
                {vars.length > 0 && <hr className="pinrow-rule" />}
                <h4 className="bindfld-group">{strings.bind.mockData}</h4>
                {fits.length === 0 && <p className="dim">{strings.pinMock.none}</p>}
                <ul className="plain menu">
                  {fits.map(([k, m]) => <li key={k}><button type="button" className="pinrow-opt" onClick={() => { setMock(k); close() }}><FlaskConical size={14} className="pinrow-ico" aria-hidden="true" />{k} <span className="dim">{mockType(m)}</span></button></li>)}
                  <li><button type="button" className="pinrow-opt" onClick={() => { create(); close() }}><FlaskConical size={14} className="pinrow-ico" aria-hidden="true" />{strings.pinMock.newField}</button></li>
                </ul>
              </>
            )}
          </div>
        )}
      </Popover>
    </div>
  )
}

/** The Inspector's Inputs section body: one row per input pin (its field when unwired, its wire when wired), then the node's own settings. */
export function PinInputs(p: PinRowsProps) {
  const byKey = new Map(p.rows.map((r) => [r.key, r]))
  const pinNames = new Set(p.inputs.map((x) => x.name))
  const settings = p.rows.filter((r) => !pinNames.has(r.key))
  return (
    <>
      {p.inputs.map((pin, slot) => {
        const edge = p.edges.find((e) => e.target === p.node.id && pinName(e.targetHandle) === pin.name)
        const from = edge && p.nodes.find((n) => n.id === edge.source)
        const fromDef = from && p.defs.get(from.data.kind)
        const isVariable = fromDef?.kind === 'GetVariable'
        const fromTitle = fromDef?.title ?? from?.data.kind ?? ''
        const varName = from && isVariable ? p.ctx.variables.find((v) => v.id === from.data.fields['variable'])?.name : undefined
        const wireText = from && edge ? (isVariable && varName ? strings.insp.gnFromVariable(varName) : strings.insp.gnFrom(fromTitle, pinName(edge.sourceHandle))) : ''
        const row = byKey.get(pin.name)
        const seed = p.node.data.fields[pin.name] ?? pinDefault(p.def, pin.name)
        return (
          <div className="pinrow" key={pin.name} data-testid={`pinrow-${pin.name}`}>
            <div className="pinrow-label">{pinLabel(p.def, pin.name, 'inputs')}</div>
            {pin.type === 'Exec' ? (
              from ? <WireRow type="Exec" text={wireText} target={from} p={p} /> : <NotConnected />
            ) : (
              <BindInput p={p} pin={pin} slot={slot} seed={seed} wire={from ? { text: wireText, variable: isVariable, source: from } : undefined}>
                {from ? <WireRow type={pin.type} text={wireText} target={from} p={p} /> : row ? <FieldEditor row={row} ctx={p.ctx} bare /> : <NotConnected />}
              </BindInput>
            )}
          </div>
        )
      })}
      {settings.map((r) => <FieldEditor key={r.key} row={r} ctx={p.ctx} />)}
    </>
  )
}

/** The Outputs section body: one row per output pin, listing the wires that leave it. */
export function PinOutputs(p: PinRowsProps) {
  return (
    <>
      {p.outputs.map((pin) => {
        const wires = p.edges.filter((e) => e.source === p.node.id && pinName(e.sourceHandle) === pin.name)
        return (
          <div className="pinrow" key={pin.name} data-testid={`pinrow-out-${pin.name}`}>
            <div className="pinrow-label">{pinLabel(p.def, pin.name, 'outputs')}</div>
            {wires.length === 0 && <NotConnected />}
            {wires.map((e) => {
              const to = p.nodes.find((n) => n.id === e.target)
              const title = to ? p.defs.get(to.data.kind)?.title ?? to.data.kind : e.target
              return <WireRow key={e.id} type={pin.type} text={strings.insp.gnTo(title, pinLabel(to ? p.defs.get(to.data.kind) ?? p.def : p.def, pinName(e.targetHandle), 'inputs'))} target={to} p={p} />
            })}
          </div>
        )
      })}
    </>
  )
}
