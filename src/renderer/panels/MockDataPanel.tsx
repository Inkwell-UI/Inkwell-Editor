import { useState } from 'react'
import { Plus, Trash2, TriangleAlert } from 'lucide-react'
import { BIND_NAME, mockDataOf, setMockKey, withMockData, type MockData, type MockValue } from '../../shared/graphBinding'
import { useSwfGraphs } from '../hooks/useGraphs'
import { useActiveOverlay, useActiveSwf } from '../hooks/useProject'
import { PIN_STYLE } from '../model/graphModel'
import { inferMock, mockType, mockUses, mockValue } from '../model/variables'
import { openGraphs } from '../state/graphDocs'
import { editOverlay } from '../state/overlayStore'
import { strings } from '../../shared/strings'
import { Btn } from '../ui/Btn'
import { Panel } from './Panel'

/**
 * Zone 6A, tab 4 (UX 4.6). Mock data is a key/value list per SWF that data bindings and node inputs can use and Ruffle Play mode will feed (it is never shipped). It is
 * stored in the SWF's overlay document under `mockData` (`swfs/<name>/overlay.json`), so edits join the SWF's undo history. Text boxes commit on blur
 * or Enter. Fields are grouped by whether anything reads them (`mockUses`); a key that is read but has no value is listed too, with no type until it gets one.
 * The JSON view and presets arrive with list mock data.
 */
export function MockDataPanel() {
  const swf = useActiveSwf()
  const overlay = useActiveOverlay()
  useSwfGraphs() // loads the graphs whose node inputs are read below
  const data = mockDataOf(overlay)
  const entries = Object.entries(data)
  const uses = swf ? mockUses(overlay, openGraphs(swf.id), (id) => swf.ir.nodes[id]?.name) : new Map<string, string[]>()
  const usedBy = (k: string): string[] => uses.get(k) ?? []
  const missing = [...uses].filter(([k, list]) => list.length > 0 && !Object.hasOwn(data, k)).map(([k]) => k)
  const inUse = entries.filter(([k]) => usedBy(k).length > 0)
  const unused = entries.filter(([k]) => usedBy(k).length === 0)
  const commit = (next: MockData): void => swf && editOverlay(swf.id, (doc) => withMockData(doc, next))
  const add = (): void => {
    let i = entries.length + 1
    while (Object.hasOwn(data, `field${i}`)) i++
    commit({ ...data, [`field${i}`]: '' })
  }
  const row = (k: string, value: MockValue | undefined, removable: boolean) => (
    <MockRow key={`${k}=${typeof value}:${String(value)}`} k={k} value={value} used={usedBy(k)} editableKey={removable}
      onKey={(n) => commit(setMockKey(data, k, n))} onValue={(v) => commit({ ...data, [k]: v })} onRemove={removable ? () => commit(setMockKey(data, k, undefined)) : undefined} />
  )
  return (
    <Panel title={strings.mock.title}>
      <div className="toolbar">
        {entries.length + missing.length > 0 && (
          <span className="mock-summary">
            {missing.length > 0 && <TriangleAlert size={13} className="tone-warn" aria-hidden="true" />}
            {strings.mock.summary(missing.length, entries.length + missing.length)}
          </span>
        )}
        <Btn icon={Plus} onClick={add} testId="mock-add" reason={swf ? undefined : strings.nav.noSwf}>{strings.mock.add}</Btn>
        <Btn variant="quiet" reason={strings.mock.later}>{strings.mock.presets}</Btn>
      </div>
      {entries.length + missing.length === 0 && <p className="empty">{strings.mock.empty}</p>}
      <div className="mock" data-testid="mock-panel">
        {inUse.length + missing.length > 0 && (
          <div className="mock-group">
            <h3 className="mock-title">{strings.mock.inUse(inUse.length + missing.length)}</h3>
            {inUse.map(([k, v]) => row(k, v, false))}
            {missing.map((k) => row(k, undefined, false))}
          </div>
        )}
        {unused.length > 0 && (
          <div className="mock-group">
            <h3 className="mock-title">{strings.mock.unused(unused.length)}</h3>
            {unused.map(([k, v]) => row(k, v, true))}
          </div>
        )}
      </div>
    </Panel>
  )
}

interface MockRowProps {
  k: string
  /** Undefined: something reads this key but the field has no value (and so no type) yet. */
  value: MockValue | undefined
  used: string[]
  /** A field nothing reads can be renamed and removed; renaming one that is read would break its bindings. */
  editableKey: boolean
  onKey(n: string): void
  onValue(v: MockValue): void
  onRemove: (() => void) | undefined
}

function MockRow({ k, value, used, editableKey, onKey, onValue, onRemove }: MockRowProps) {
  const [key, setKey] = useState(k)
  const [text, setText] = useState(String(value ?? ''))
  const type = value === undefined ? undefined : mockType(value)
  const enter = (e: React.KeyboardEvent<HTMLInputElement>): void => void (e.key === 'Enter' && e.currentTarget.blur())
  // An empty field has no type to keep, so what is typed decides it (3 is a Number, true a Bool); once it has a value, its type stays until the dropdown changes it.
  const commitText = (): void => {
    if (value === undefined && text === '') return
    const next = type === undefined || value === '' ? inferMock(text) : mockValue(type, text)
    if (next !== value) onValue(next)
  }
  const used0 = used.length === 0
  const missing = value === undefined
  return (
    <div className="mock-row" data-testid={`mock-${k}`}>
      <span className="mock-name">
        <span className={`var-chip-dot${type ? '' : ' mock-dot-none'}`} style={type ? { background: PIN_STYLE[type].color } : undefined} aria-hidden="true" />
        {editableKey
          ? <input className="gn-input mono" aria-label={strings.mock.key} value={key} onChange={(e) => setKey(e.target.value)} onBlur={() => key !== k && onKey(key)} onKeyDown={enter} aria-invalid={!BIND_NAME.test(key) || undefined} />
          : <span className="mock-key mono" title={k}>{k}</span>}
        {missing && <span className="tone-warn bind-warn" role="img" aria-label={strings.mock.missingTip(k)} title={strings.mock.missingTip(k)}><TriangleAlert size={13} aria-hidden="true" /></span>}
      </span>
      <select className="gn-input mock-type" aria-label={strings.mock.type} value={type ?? ''} onChange={(e) => onValue(mockValue(e.target.value as 'String' | 'Number' | 'Bool', e.target.value === 'Bool' ? 'false' : text))}>
        {type === undefined && <option value="" disabled hidden>{strings.mock.typeUnknown}</option>}
        {['String', 'Number', 'Bool'].map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      {type === 'Bool' ? (
        <input type="checkbox" aria-label={strings.mock.value} checked={value === true} onChange={(e) => onValue(e.target.checked)} />
      ) : (
        <input className="gn-input" aria-label={strings.mock.value} placeholder={missing ? strings.mock.valueMissing : undefined} value={text} onChange={(e) => setText(e.target.value)} onBlur={commitText} onKeyDown={enter} />
      )}
      <span className={`mock-used${used0 ? ' is-none' : ''}`} title={used.join(', ')}>{used0 ? strings.mock.nothingReads : used.join(', ')}</span>
      {onRemove ? <Btn icon={Trash2} className="btn-hover-err" label={strings.mock.remove(k)} onClick={onRemove} /> : <span />}
    </div>
  )
}
