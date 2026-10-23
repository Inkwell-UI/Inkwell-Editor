import type { PreviewBuild } from '../../shared/preview'
import type { PreviewBackend, PreviewBackendEvents } from './backend'

// The slice of Ruffle's self-hosted API used here (https://github.com/ruffle-rs/ruffle/wiki/Using-Ruffle#javascript-api).
interface RufflePlayerElement extends HTMLElement {
  ruffle(): { load(opts: Record<string, unknown>): Promise<void>; destroy?(): void }
}
interface RuffleGlobal {
  RufflePlayer?: { config?: Record<string, unknown>; newest?(): { createPlayer(): RufflePlayerElement } | null }
}

/** Ruffle's files are copied next to index.html (see electron.vite.config.ts), so they are found relative to the page. No network is used. */
let loading: Promise<void> | undefined
function loadRuffle(): Promise<void> {
  loading ??= new Promise((resolve, reject) => {
    const RUFFLE_DIR = new URL('./', document.baseURI).href
    const g = window as unknown as RuffleGlobal
    g.RufflePlayer = { config: { publicPath: RUFFLE_DIR, polyfills: false, autoplay: 'on', unmuteOverlay: 'hidden', splashScreen: false, contextMenu: 'off', letterbox: 'on', logLevel: 'warn' } }
    const s = document.createElement('script')
    s.src = `${RUFFLE_DIR}ruffle.js`
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Could not load ruffle.js'))
    document.head.appendChild(s)
  })
  return loading
}

/**
 * The only 1.0 preview: Ruffle. It approximates Flash, not Scaleform GFx: it cannot load gfxfontlib.swf, ignores GFx TextField extensions and
 * reports another Flash version, which is why the preview SWF uses device fonts and the preview shows ShimBadge.
 * `firstFrame` is `loadeddata` (Ruffle has parsed the movie and run its first frame) plus one animation frame so it has been painted.
 */
export class RuffleBackend implements PreviewBackend {
  readonly element: HTMLElement
  private player: RufflePlayerElement | undefined
  private readonly subs: { [E in keyof PreviewBackendEvents]: Set<(v: PreviewBackendEvents[E]) => void> } = { loaded: new Set(), error: new Set(), firstFrame: new Set() }
  private disposed = false

  constructor() {
    this.element = document.createElement('div') // stable host; the player is created on first load
    this.element.className = 'ruffle-host'
  }

  on<E extends keyof PreviewBackendEvents>(event: E, cb: (value: PreviewBackendEvents[E]) => void): () => void {
    this.subs[event].add(cb)
    return () => void this.subs[event].delete(cb)
  }

  private emit<E extends keyof PreviewBackendEvents>(event: E, value: PreviewBackendEvents[E]): void {
    this.subs[event].forEach((cb) => cb(value))
  }

  async load(build: PreviewBuild): Promise<void> {
    if (!build.bytes) throw new Error('No SWF bytes')
    await loadRuffle()
    if (this.disposed) return
    const ruffle = (window as unknown as RuffleGlobal).RufflePlayer?.newest?.()
    if (!ruffle) throw new Error('Ruffle did not initialise')
    this.player?.remove()
    const player = (this.player = ruffle.createPlayer())
    player.style.width = '100%'
    player.style.height = '100%'
    this.element.appendChild(player)
    player.addEventListener('loadedmetadata', () => this.emit('loaded', undefined), { once: true })
    player.addEventListener(
      'loadeddata',
      () => requestAnimationFrame(() => !this.disposed && this.player === player && this.emit('firstFrame', undefined)),
      { once: true }
    )
    try {
      await player.ruffle().load({ data: build.bytes, swfFileName: `${build.name}.preview.swf`, allowScriptAccess: false })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.emit('error', msg)
      throw new Error(msg)
    }
  }

  dispose(): void {
    this.disposed = true
    this.player?.ruffle().destroy?.()
    this.player?.remove()
    this.element.remove()
    Object.values(this.subs).forEach((s) => s.clear())
  }
}
