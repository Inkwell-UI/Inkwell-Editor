import { Plus, X } from 'lucide-react'
import type { Graph } from '@inkwell-ui/spec'
import { ident } from '../../shared/overlay'
import { layerChoices, type FieldRow, type LayerOption } from '../model/graphModel'
import { strings } from '../strings'

/** What the field editors need from their surroundings (the canvas node or the Inspector). */
export interface FieldCtx {
  setField(key: string, value: unknown): void
  /** Layers for the picker; filtered per row by pin type. */
  layers: readonly LayerOption[]
  variables: Graph['variables']
  /** Names of pins (or fields) that carry an issue. */
  badPins?: ReadonlySet<string>
}

const IDENT = '^[A-Za-z_][A-Za-z0-9_]*$'
const PARAM_TYPES = ['String', 'Number', 'Bool'] as const
type Param = { name: string; type: (typeof PARAM_TYPES)[number] }

/** One inline editor. `bare` drops the label (a pin row already shows its own). Inputs carry `nodrag nowheel` so React Flow leaves them alone. */
export function FieldEditor({ row, ctx, bare }: { row: FieldRow; ctx: FieldCtx; bare?: boolean }) {
  const bad = ctx.badPins?.has(row.key) ?? false
  const common = { className: `gn-input nodrag nowheel${bad ? ' is-bad' : ''}`, 'aria-invalid': bad || undefined, 'aria-label': row.label } as const
  const set = (v: unknown): void => ctx.setField(row.key, v)
  let editor
  switch (row.kind) {
    case 'enum':
      editor = (
        <select {...common} value={String(row.value ?? row.options?.[0] ?? '')} onChange={(e) => set(e.target.value)}>
          {row.options?.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )
      break
    case 'number':
      editor = <input {...common} type="number" value={typeof row.value === 'number' ? row.value : ''} onChange={(e) => set(e.target.value === '' ? undefined : Number(e.target.value))} />
      break
    case 'bool':
      editor = <input {...common} type="checkbox" checked={row.value === true} onChange={(e) => set(e.target.checked)} />
      break
    case 'text':
      editor = <textarea {...common} rows={3} value={typeof row.value === 'string' ? row.value : ''} onChange={(e) => set(e.target.value)} />
      break
    case 'layer': {
      const id = typeof row.value === 'string' ? row.value : ''
      const options = layerChoices(ctx.layers, row.pinType)
      const missing = id !== '' && !options.some((o) => o.id === id)
      editor = (
        <select {...common} className={`${common.className}${missing ? ' is-bad' : ''}`} value={id} onChange={(e) => set(e.target.value === '' ? undefined : e.target.value)} data-testid="layer-picker">
          <option value="">{strings.graph.pickLayer(row.pinType ?? 'Clip')}</option>
          {missing && <option value={id}>{strings.graph.missingLayer(id)}</option>}
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      )
      break
    }
    case 'variable': {
      const id = typeof row.value === 'string' ? row.value : ''
      editor = (
        <select {...common} value={id} onChange={(e) => set(e.target.value === '' ? undefined : e.target.value)}>
          <option value="">{strings.vars.pick}</option>
          {id !== '' && !ctx.variables.some((v) => v.id === id) && <option value={id}>{id}</option>}
          {ctx.variables.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.type})</option>)}
        </select>
      )
      break
    }
    case 'params':
      editor = <ParamsEditor value={row.value} onChange={set} />
      break
    default: {
      const text = typeof row.value === 'string' ? row.value : ''
      const bad2 = row.pattern !== undefined && text !== '' && !new RegExp(row.pattern).test(text)
      editor = (
        <input {...common} className={`${common.className}${bad2 ? ' is-bad' : ''}`} type="text" value={text} aria-invalid={bad || bad2 || undefined} onChange={(e) => set(row.pattern === IDENT && e.target.value !== '' ? ident(e.target.value) : e.target.value)} />
      )
    }
  }
  if (bare || row.kind === 'params') return editor
  return <label className="gn-field"><span className="gn-field-label">{row.label}</span>{editor}</label>
}

/** The On Widget Call parameters: a name and a type each (the Papyrus function gets the same signature). */
export function ParamsEditor({ value, onChange }: { value: unknown; onChange(v: Param[]): void }) {
  const params: Param[] = Array.isArray(value) ? (value as Param[]) : []
  const edit = (i: number, patch: Partial<Param>): void => onChange(params.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  const next = `param${params.length + 1}`
  return (
    <div className="gn-params" data-testid="params-editor">
      <div className="gn-field-label">{strings.graph.params}</div>
      {params.map((p, i) => (
        <div className="gn-param" key={i}>
          <input className="gn-input nodrag nowheel" aria-label={strings.graph.paramName} value={p.name} aria-invalid={!new RegExp(IDENT).test(p.name) || undefined} onChange={(e) => edit(i, { name: e.target.value === '' ? '' : ident(e.target.value) })} />
          <select className="gn-input nodrag nowheel" aria-label={strings.graph.paramType} value={p.type} onChange={(e) => edit(i, { type: e.target.value as Param['type'] })}>
            {PARAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button type="button" className="gn-icon nodrag" title={strings.graph.removeParam} aria-label={strings.graph.removeParam} onClick={() => onChange(params.filter((_, j) => j !== i))}><X size={12} aria-hidden="true" /></button>
        </div>
      ))}
      <button type="button" className="gn-add nodrag" onClick={() => onChange([...params, { name: next, type: 'String' }])}><Plus size={12} aria-hidden="true" />{strings.graph.addParam}</button>
    </div>
  )
}
