import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createStageTimer, type BuildTiming } from '../shared/timing'
import { strings } from './strings'
import { TimingOverlay } from './TimingOverlay'

const timer = createStageTimer()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Fake stages until the real pipeline exists.
async function fakeBuild(): Promise<BuildTiming> {
  for (const [name, ms] of [['sync', 20], ['codegen', 35], ['ffdec', 90], ['preview', 40]] as const) {
    timer.start(name)
    await sleep(ms)
    timer.end(name)
  }
  return timer.finishBuild()
}

function App() {
  const [build, setBuild] = useState<BuildTiming>()
  useEffect(() => {
    document.title = strings.windowTitle
    void fakeBuild().then(setBuild)
  }, [])
  return (
    <main>
      <h1>{strings.placeholderHeading}</h1>
      <p>{strings.placeholderBody}</p>
      <TimingOverlay build={build} />
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
