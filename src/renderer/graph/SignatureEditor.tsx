import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { FUNCTION_PIN_TYPES } from '@inkwell-ui/spec'
import { useStore } from 'zustand'
import { strings } from '../strings'
import type { GraphStore } from '../state/graphStore'

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
const RESERVED = ['function', 'inputs', 'outputs', 'exits'] // a call node keeps its settings under these names
type Sig = NonNullable<ReturnType<GraphStore['getState']>['signature']>
type Kind = 'inputs' | 'outputs' | 'exits'

/** Why `name` cannot be the name of entry `index` of `kind`, or undefined. Same rules as the validator (`graph-function`). */
export function nameProblem(sig: Sig, kind: Kind, index: number, name: string): string | undefined {
  if (!IDENT.test(name)) return strings.graph.sigBadName
  if (kind === 'inputs' && RESERVED.includes(name)) return strings.graph.sigReserved(name)
  if (sig[kind].some((p, i) => i !== index && p.name === name)) return strings.graph.sigDuplicate(name)
  if (kind === 'outputs' && sig.exits.some((x) => x.name === name)) return strings.graph.sigDuplicate(name)
  if (kind === 'exits' && sig.outputs.some((o) => o.name === name)) return strings.graph.sigDuplicate(name)
  return undefined
}

/** A name box that applies on Enter or when it loses focus, and only when the name is valid (an invalid draft is shown in red and dropped on blur). */
function NameBox({ value, problem, label, onCommit }: { value: string; problem(name: string): string | undefined; label: string; onCommit(name: string): void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const why = draft === value ? undefined : problem(draft)
  const commit = (): void => {
    if (draft !== value && !problem(draft)) onCommit(draft)
    else setDraft(value)
  }
  return (
    <input
      className={`gn-input${why ? ' is-bad' : ''}`}
      aria-label={label}
      aria-invalid={why ? true : undefined}
      title={why}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => (e.key === 'Enter' ? commit() : e.key === 'Escape' && setDraft(value))}
    />
  )
}

/**
 * The interface of the open function graph, shown in the Inspector: the Function Entry node edits the inputs, the Function Exit node the outputs and exits (`sections`). Every change is one `setSignature` (undoable); the wires of the function's Entry and Exit nodes and
 * the calls in the other graphs follow by pin id (docs/functions.md). A name is applied only when it is valid, so the file never holds a signature the Spec refuses.
 */
export function SignatureEditor({ store, sections }: { store: GraphStore; sections: readonly Kind[] }) {
  const sig = useStore(store, (s) => s.signature)
  if (!sig) return null
  const set = (next: Sig): void => store.getState().setSignature(next)
  const fresh = (kind: Kind, base: string): string => {
    for (let k = sig[kind].length + 1; ; k++) if (!nameProblem(sig, kind, -1, `${base}${k}`)) return `${base}${k}`
  }
  const pins = (kind: 'inputs' | 'outputs'): React.ReactNode => (
    <div className="sig-group" data-testid={`sig-${kind}`}>
      <div className="gn-field-label">{kind === 'inputs' ? strings.graph.sigInputs : strings.graph.sigOutputs}</div>
      {sig[kind].map((p, i) => (
        <div className="gn-param" key={p.id}>
          <NameBox value={p.name} label={strings.graph.sigName} problem={(n) => nameProblem(sig, kind, i, n)} onCommit={(name) => set({ ...sig, [kind]: sig[kind].map((x, j) => (j === i ? { ...x, name } : x)) })} />
          <select className="gn-input" aria-label={strings.graph.sigType} value={p.type} onChange={(e) => set({ ...sig, [kind]: sig[kind].map((x, j) => (j === i ? { ...x, type: e.target.value as typeof p.type } : x)) })}>
            {FUNCTION_PIN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button type="button" className="gn-icon" title={strings.graph.sigRemove(p.name)} aria-label={strings.graph.sigRemove(p.name)} onClick={() => set({ ...sig, [kind]: sig[kind].filter((_, j) => j !== i) })}><X size={12} aria-hidden="true" /></button>
        </div>
      ))}
      <button type="button" className="gn-add" onClick={() => set({ ...sig, [kind]: [...sig[kind], { id: crypto.randomUUID(), name: fresh(kind, kind === 'inputs' ? 'input' : 'output'), type: 'String' }] })}>
        <Plus size={12} aria-hidden="true" />{kind === 'inputs' ? strings.graph.sigAddInput : strings.graph.sigAddOutput}
      </button>
    </div>
  )
  return (
    <section className="signature" aria-label={strings.graph.sigTitle} data-testid="signature-editor">
      <h4 className="sig-title">{strings.graph.sigTitle}</h4>
      <div className="sig-body">
        {sections.includes('inputs') && pins('inputs')}
        {sections.includes('outputs') && pins('outputs')}
        {sections.includes('exits') && <div className="sig-group" data-testid="sig-exits">
          <div className="gn-field-label">{strings.graph.sigExits}</div>
          {sig.exits.map((x, i) => (
            <div className="gn-param sig-exit" key={x.id}>
              <NameBox value={x.name} label={strings.graph.sigName} problem={(n) => nameProblem(sig, 'exits', i, n)} onCommit={(name) => set({ ...sig, exits: sig.exits.map((e, j) => (j === i ? { ...e, name } : e)) })} />
              <button type="button" className="gn-icon" disabled={sig.exits.length === 1} title={sig.exits.length === 1 ? strings.graph.sigLastExit : strings.graph.sigRemove(x.name)} aria-label={strings.graph.sigRemove(x.name)} onClick={() => set({ ...sig, exits: sig.exits.filter((_, j) => j !== i) })}><X size={12} aria-hidden="true" /></button>
            </div>
          ))}
          <button type="button" className="gn-add" onClick={() => set({ ...sig, exits: [...sig.exits, { id: crypto.randomUUID(), name: fresh('exits', 'exit') }] })}>
            <Plus size={12} aria-hidden="true" />{strings.graph.sigAddExit}
          </button>
        </div>}
      </div>
    </section>
  )
}
