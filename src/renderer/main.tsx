import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme.css'
import './styles.css'
import { PreviewPanel } from './panels/PreviewPanel'
import { AppShell } from './shell/AppShell'
import { startBridge } from './state/bridge'
import { isPreviewWindow } from './state/popoutStore'
import { strings } from './strings'

startBridge()
const preview = isPreviewWindow() // `?panel=preview`: the popped-out preview window shows only the stage (with its toolbar)
document.title = preview ? strings.previewWindowTitle : strings.windowTitle
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {preview ? (
      <div className="detached">
        <PreviewPanel />
      </div>
    ) : (
      <AppShell />
    )}
  </StrictMode>
)
