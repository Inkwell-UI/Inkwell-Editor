import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { BIND_NAME, mockDataOf, setMockKey, withMockData, type MockData, type MockValue } from '../../shared/graphBinding'
import { useActiveOverlay, useActiveSwf } from '../hooks/useProject'
import { mockType, mockValue } from '../model/variables'
import { editOverlay } from '../state/overlayStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Panel } from './Panel'

/**
 * Zone 6A, tab 4 (UX 4.6). Mock data is a key/value list per SWF that data bindings can use and Ruffle Play mode will feed (it is never shipped). It is
 * stored in the SWF's overlay document under `mockData` (`swfs/<name>/overlay.json`), so edits join the SWF's undo history. Text boxes commit on blur
 * or Enter. Presets and the JSON view arrive with list mock data.
 */
export function MockDataPanel() {
  const swf = useActiveSwf()
  const overlay = useActiveOverlay()
  const data = mockDataOf(overlay)
  const entries = Object.entries(data)
  const commit = (next: MockData): void => swf && editOverlay(swf.id, (doc) => withMockData(doc, next))
  const add = (): void => {
    let i = entries.length + 1
    while (Object.hasOwn(data, `field${i}`)) i++
    commit({ ...data, [`field${i}`]: '' })
  }
  return (
    <Panel title={strings.mock.title}>
      <div className="toolbar">
        <Btn icon={Plus} onClick={add} testId="mock-add" reason={swf ? undefined : strings.nav.noSwf}>{strings.mock.add}</Btn>
        {strings.mock.presets.map((p) => <Btn key={p} reason={strings.mock.later}>{p}</Btn>)}
      </div>
      {entries.length === 0 && <p className="empty">{strings.mock.empty}</p>}
      <div className="mock" data-testid="mock-panel">
        {entries.map(([key, value]) => (
          <MockRow key={`${key}=${typeof value}:${String(value)}`} k={key} value={value} onKey={(n) => commit(setMockKey(data, key, n))} onValue={(v) => commit({ ...data, [key]: v })} onRemove={() => commit(setMockKey(data, key, undefined))} />
        ))}
      </div>
    </Panel>
  )
}

function MockRow({ k, value, onKey, onValue, onRemove }: { k: string; value: MockValue; onKey(n: string): void; onValue(v: MockValue): void; onRemove(): void }) {
  const [key, setKey] = useState(k)
  const [text, setText] = useState(String(value))
  const type = mockType(value)
  const enter = (e: React.KeyboardEvent<HTMLInputElement>): void => void (e.key === 'Enter' && e.currentTarget.blur())
  return (
    <div className="mock-row" data-testid={`mock-${k}`}>
      <input className="gn-input mono" aria-label={strings.mock.key} value={key} onChange={(e) => setKey(e.target.value)} onBlur={() => key !== k && onKey(key)} onKeyDown={enter} aria-invalid={!BIND_NAME.test(key) || undefined} />
      <select className="gn-input" aria-label={strings.mock.type} value={type} onChange={(e) => onValue(mockValue(e.target.value as typeof type, e.target.value === 'Bool' ? 'false' : text))}>
        {['String', 'Number', 'Bool'].map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      {type === 'Bool' ? (
        <input type="checkbox" aria-label={strings.mock.value} checked={value === true} onChange={(e) => onValue(e.target.checked)} />
      ) : (
        <input className="gn-input" aria-label={strings.mock.value} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onValue(mockValue(type, text))} onKeyDown={enter} />
      )}
      <Btn icon={Trash2} label={strings.mock.remove(k)} onClick={onRemove} />
    </div>
  )
}
