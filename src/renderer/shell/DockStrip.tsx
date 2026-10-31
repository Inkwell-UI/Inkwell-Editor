import { useHotReload } from '../hooks/useHotReload'
import { useProject } from '../hooks/useProject'
import { useDevStore } from '../state/devStore'
import { useTraceStore } from '../state/traceStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'

/** What the folded Behaviour dock still says: how much trace there is, and the Hot Reload button (the Trace panel's own, see `useHotReload`). */
export function DockStrip() {
  const project = useProject()
  const game = useDevStore((s) => s.source) === 'game'
  const ruffleCount = useTraceStore((s) => s.lines.length)
  const gameCount = useDevStore((s) => s.lines.length)
  const lines = game ? gameCount : ruffleCount
  const reload = useHotReload()
  return (
    <div className="dock-strip" data-testid="dock-strip">
      <span className="dock-strip-text dim" role="status">{lines ? strings.trace.lineCount(lines) : project ? strings.trace.empty : strings.trace.start}</span>
      {reload.text && <span className={`dock-strip-text ${reload.bad ? 'tone-error' : 'dim'}`}>{reload.text}</span>}
      <Btn onClick={() => void reload.trigger()} reason={reload.reason} testId="strip-reload">{strings.trace.hotReload}</Btn>
    </div>
  )
}
