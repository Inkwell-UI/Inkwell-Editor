import { useEffect, useState, useSyncExternalStore } from 'react'
import { DoorClosed, DoorOpen, MousePointerClick, Play } from 'lucide-react'
import { useSwfGraphs } from '../hooks/useGraphs'
import { useActiveOverlay, useActiveSwf } from '../hooks/useProject'
import { callArgs, playEntries, type PlayEntry } from '../model/playEntries'
import { previewBus } from '../preview/previewBus'
import { useGraphDocs } from '../state/graphDocs'
import { findGraphStore, toGraph } from '../state/graphStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Panel } from './Panel'

/** Custom menu: fire what the runtime fires (open, close) and a click on a Button layer in the Ruffle mock of the runtime (docs/menus.md). */
function MenuControls({ running }: { running: boolean }) {
  const swf = useActiveSwf()
  const overlay = useActiveOverlay()
  const buttons = Object.entries(overlay?.nodes ?? {}).filter(([id, o]) => o['role'] === 'button' && swf?.ir.nodes[id]).map(([id]) => ({ id, name: swf!.ir.nodes[id]!.name }))
  const [pick, setPick] = useState<string | undefined>()
  const [result, setResult] = useState<{ ok: boolean; text: string }>()
  const target = buttons.find((b) => b.id === pick) ?? buttons[0]
  const reason = running ? undefined : strings.play.noPreview
  const done = (ok: boolean, what: string): void => setResult({ ok, text: ok ? strings.play.menuCalled(what, new Date().toLocaleTimeString()) : strings.play.menuFailed })
  return (
    <div className="play-menu" data-testid="play-menu">
      <h3>{strings.play.menuTitle}</h3>
      <div className="toolbar">
        <Btn icon={DoorOpen} onClick={() => done(previewBus.call('inkwellMenuOpen'), strings.play.menuOpened)} reason={reason} testId="play-menu-open">{strings.play.menuOpen}</Btn>
        <Btn icon={DoorClosed} onClick={() => done(previewBus.call('inkwellMenuClose'), strings.play.menuClosed)} reason={reason} testId="play-menu-close">{strings.play.menuClose}</Btn>
        {target ? (
          <>
            <label>
              {strings.play.menuTarget}{' '}
              <select value={target.id} onChange={(e) => setPick(e.target.value)} aria-label={strings.play.menuTarget} data-testid="play-menu-target">
                {buttons.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <Btn icon={MousePointerClick} onClick={() => done(previewBus.call('inkwellClick', target.id), strings.play.menuClicked(target.name))} reason={reason} testId="play-menu-click">{strings.play.menuClick}</Btn>
          </>
        ) : <span className="dim">{strings.play.menuNoButtons}</span>}
      </div>
      {result && <p className={result.ok ? 'dim' : 'tone-error'} role="status" data-testid="play-menu-result">{result.text}</p>}
    </div>
  )
}

const memory: { pick: string | undefined; values: Record<string, Record<string, string | boolean>> } = { pick: undefined, values: {} }

/** The On Widget Call entries of the active SWF's graphs, kept current while graphs are edited. */
function useEntries(): PlayEntry[] {
  const swf = useActiveSwf()
  const ids = useGraphDocs((s) => (swf ? s.ids[swf.id] : undefined))
  const [entries, setEntries] = useState<PlayEntry[]>([])
  useEffect(() => {
    if (!swf) return setEntries([])
    const stores = (ids ?? []).flatMap((id) => findGraphStore(swf.id, id) ?? [])
    const read = (): void => {
      const next = playEntries(stores.map((s) => toGraph(s.getState())))
      setEntries((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }
    read()
    const offs = stores.map((s) => s.subscribe(read))
    return () => offs.forEach((off) => off())
  }, [swf, ids])
  return entries
}

/**
 * Zone 6A, Play tab (UX 4.3 Play mode, docs/debugging.md): fires an On Widget Call entry in the running Ruffle preview, the way Papyrus fires it in game.
 * Pick the entry, fill its typed parameters, Call. The movie runs the generated clip method (all arguments as one string array); what the graph does shows in the
 * preview, the Runtime Trace panel and the pin badges on the canvas.
 */
export function PlayPanel() {
  const swf = useActiveSwf()
  const { loaded } = useSwfGraphs()
  const entries = useEntries()
  // a tab switch unmounts the panel: the chosen entry and typed values are kept for the window's lifetime
  const [pick, setPickState] = useState(memory.pick)
  const [values, setValuesState] = useState(memory.values)
  const setPick = (k: string): void => (memory.pick = k, setPickState(k))
  const setValues = (f: (s: typeof values) => typeof values): void => setValuesState((s) => (memory.values = f(s)))
  const [result, setResult] = useState<{ ok: boolean; text: string }>()
  const running = useSyncExternalStore(previewBus.subscribe, previewBus.available)
  const entry = entries.find((e) => e.key === pick) ?? entries[0]
  const mine = entry ? (values[entry.key] ?? {}) : {}
  const set = (name: string, v: string | boolean): void => entry && setValues((s) => ({ ...s, [entry.key]: { ...s[entry.key], [name]: v } }))
  const call = (): void => {
    if (!entry) return
    const args = callArgs(entry.params, mine)
    const ok = previewBus.call('inkwellCall', entry.name, args)
    setResult({ ok, text: ok ? strings.play.called(entry.name, args, new Date().toLocaleTimeString()) : strings.play.failed(entry.name) })
  }
  const reason = !swf ? strings.nav.noSwf : !entry ? undefined : !running ? strings.play.noPreview : undefined
  return (
    <Panel title={strings.play.title}>
      <div className="play" data-testid="play-panel">
        {swf?.ir.target.kind === 'customMenu' && <MenuControls running={running} />}
        {!entry ? (
          swf?.ir.target.kind === 'customMenu' ? null : <p className="empty">{!swf ? strings.nav.noSwf : loaded ? strings.play.noEntries : strings.graph.loading}</p>
        ) : (
          <>
            <div className="toolbar">
              <label>
                {strings.play.entry}{' '}
                <select value={entry.key} onChange={(e) => setPick(e.target.value)} aria-label={strings.play.entry} data-testid="play-entry">
                  {entries.map((e) => <option key={e.key} value={e.key}>{e.name}({e.params.map((p) => p.name).join(', ')}) - {e.graphName}</option>)}
                </select>
              </label>
              <Btn icon={Play} variant="primary" onClick={call} testId="play-call" reason={reason}>{strings.play.call}</Btn>
            </div>
            <div className="play-params">
              {entry.params.length === 0 && <span className="dim">{strings.play.noParams}</span>}
              {entry.params.map((p) => (
                <label key={p.name} className="play-param">
                  <span className="mono">{p.name}</span> <span className="dim">{p.type}</span>
                  {p.type === 'Bool' ? (
                    <input type="checkbox" checked={mine[p.name] === true} onChange={(e) => set(p.name, e.target.checked)} data-testid={`play-param-${p.name}`} />
                  ) : (
                    <input className="gn-input" value={typeof mine[p.name] === 'string' ? (mine[p.name] as string) : ''} onChange={(e) => set(p.name, e.target.value)} inputMode={p.type === 'Number' ? 'decimal' : 'text'} data-testid={`play-param-${p.name}`} />
                  )}
                </label>
              ))}
            </div>
            {result && <p className={result.ok ? 'dim' : 'tone-error'} role="status" data-testid="play-result">{result.text}</p>}
          </>
        )}
        <p className="dim">{strings.play.notice}</p>
      </div>
    </Panel>
  )
}
