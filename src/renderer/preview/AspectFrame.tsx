import type { ReactNode } from 'react'
import { ASPECTS, type AspectId } from '../../shared/preview'
import { useElementSize } from '../hooks/useElementSize'
import { screenBox } from './geometry'

/** Props of AspectFrame. */
export interface AspectFrameProps {
  /** Which screen shape to simulate. */
  aspect: AspectId
  /** Drawn inside the screen box (which is `position: relative`): a viewport, an overlay. They fill it with `position: absolute; inset: 0`. */
  children: ReactNode
}

/** The simulated screen: the largest box of the chosen aspect ratio inside its container, centred; the rest of the container stays black. */
export function AspectFrame({ aspect, children }: AspectFrameProps) {
  const [ref, size] = useElementSize<HTMLDivElement>()
  const b = screenBox(size, ASPECTS[aspect])
  return (
    <div ref={ref} className="aspect-frame">
      <div className="aspect-screen" style={{ left: b.x, top: b.y, width: b.width, height: b.height }} data-aspect={aspect}>
        {children}
      </div>
    </div>
  )
}
