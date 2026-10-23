import type { BuildTiming } from '../shared/timing'
import { strings } from './strings'

export function TimingOverlay({ build }: { build: BuildTiming | undefined }) {
  return (
    <aside style={{ position: 'fixed', right: 8, bottom: 8, padding: 8, font: '12px monospace', background: '#222', color: '#eee' }}>
      <strong>{strings.overlayTitle}</strong>
      {build ? (
        <>
          <div>
            {strings.overlayTotal}: {build.total.toFixed(1)} {strings.overlayMs}
          </div>
          {Object.entries(build.stages).map(([name, ms]) => (
            <div key={name}>
              {name}: {ms.toFixed(1)} {strings.overlayMs}
            </div>
          ))}
        </>
      ) : (
        <div>{strings.overlayNoBuilds}</div>
      )}
    </aside>
  )
}
