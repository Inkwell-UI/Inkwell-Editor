import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { strings } from './strings'
import { Workspace } from './workspace/Workspace'

document.title = strings.windowTitle
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Workspace />
  </StrictMode>
)
