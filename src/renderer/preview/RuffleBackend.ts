import type { PreviewBuild } from '../../shared/preview'
import type { PreviewBackend, PreviewBackendEvents } from './backend'
import { inkwell } from '../hooks/api'

// The slice of Ruffle's self-hosted API used here (https://github.com/ruffle-rs/ruffle/wiki/Using-Ruffle#javascript-api).
interface RufflePlayerElement extends HTMLElement {
  pause?(): void
  play?(): void
  ruffle(): { load(opts: Record<string, unknown>): Promise<void>; destroy?(): void }
}
interface RuffleGlobal {
  RufflePlayer?: { config?: Record<string, unknown>; newest?(): { createPlayer(): RufflePlayerElement } | null }
}

/** Device fonts for the preview text come from main as bytes; Ruffle fetches them by (blob) URL, so nothing touches the network. */
let fontSources: Promise<string[]> | undefined
// shortcut: fonts are read once per window; a changed font source needs a restart.
const loadFonts = (): Promise<string[]> =>
  (fontSources ??= (inkwell?.getPreviewFonts() ?? Promise.resolve([]))
    .catch(() => [])
    .then((fonts) => fonts.map((f) => URL.createObjectURL(new Blob([f.bytes], { type: 'font/ttf' })))))

/**
 * Every load runs in a frame of its own with its own copy of Ruffle. Ruffle times a movie's timers (setInterval, so Delay, On Timer and Tween) from when its page started, so a second movie in the same
 * page ran the timers of the seconds the first one had been up in one burst: a timer node fired many times at once and a Tween never finished after a Reload. A fresh page starts the clock at zero.
 * Ruffle's files are copied next to index.html (see electron.vite.config.ts), so they are found relative to the page. No network is used; the frame has no inline script (the page's CSP).
 */
async function openFrame(host: HTMLElement): Promise<{ frame: HTMLIFrameElement; ruffle: { createPlayer(): RufflePlayerElement } }> {
  const fonts = await loadFonts()
  const frame = document.createElement('iframe')
  frame.style.cssText = 'width:100%;height:100%;border:0;display:block'
  frame.srcdoc = '<!doctype html><html style="height:100%"><body style="margin:0;height:100%;overflow:hidden;background:#000"></body></html>' // the player takes the whole frame: it needs a body with a height
  host.appendChild(frame)
  await new Promise<void>((resolve) => (frame.onload = () => resolve()))
  const win = frame.contentWindow as unknown as (Window & RuffleGlobal) | null
  if (!win) throw new Error('Could not open the preview frame')
  const RUFFLE_DIR = new URL('./', document.baseURI).href
  win.RufflePlayer = { config: { publicPath: RUFFLE_DIR, polyfills: false, autoplay: 'on', unmuteOverlay: 'hidden', splashScreen: false, contextMenu: 'off', letterbox: 'on', logLevel: 'info', fontSources: fonts } }
  tapConsole((win as unknown as { console: Console }).console) // Ruffle writes the movie's trace() output to this frame's console
  await new Promise<void>((resolve, reject) => {
    const sc = win.document.createElement('script')
    sc.src = `${RUFFLE_DIR}ruffle.js`
    sc.onload = () => resolve()
    sc.onerror = () => reject(new Error('Could not load ruffle.js'))
    win.document.head.appendChild(sc)
  })
  const ruffle = win.RufflePlayer?.newest?.()
  if (!ruffle) throw new Error('Ruffle did not initialise')
  return { frame, ruffle }
}

/**
 * The only 1.0 preview: Ruffle. It approximates Flash, not Scaleform GFx: it cannot load gfxfontlib.swf, ignores GFx TextField extensions and
 * reports another Flash version, which is why the preview SWF uses device fonts.
 * `firstFrame` is `loadeddata` (Ruffle has parsed the movie and run its first frame) plus one animation frame so it has been painted.
 */
export class RuffleBackend implements PreviewBackend {
  readonly element: HTMLElement
  private player: RufflePlayerElement | undefined
  private frame: HTMLIFrameElement | undefined
  private readonly subs: { [E in keyof PreviewBackendEvents]: Set<(v: PreviewBackendEvents[E]) => void> } = { loaded: new Set(), error: new Set(), firstFrame: new Set(), trace: new Set() }
  private disposed = false
  private offTap: (() => void) | undefined

  constructor() {
    this.element = document.createElement('div') // stable host; the player is created on first load
    this.element.className = 'ruffle-host'
    this.offTap = tapTrace((line) => this.emit('trace', line))
  }

  call(fn: string, ...args: unknown[]): boolean {
    const f = (this.player as unknown as Record<string, unknown> | undefined)?.[fn]
    if (typeof f !== 'function') return false
    return f.apply(this.player, args) !== false // the shim's callbacks answer false only for "no such method"
  }

  setPaused(paused: boolean): void {
    const p = this.player
    if (!p) return
    if (paused) p.pause?.()
    else p.play?.()
    // Ruffle's own big play button would resume behind our toggle's back; the toolbar button is the one control
    ;(p.shadowRoot?.getElementById('play-button') as HTMLElement | null | undefined)?.style.setProperty('display', 'none')
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
    this.frame?.remove() // the old movie goes with its frame
    this.frame = this.player = undefined
    const { frame, ruffle } = await openFrame(this.element)
    if (this.disposed) return frame.remove()
    this.frame = frame
    const player = (this.player = ruffle.createPlayer())
    player.style.width = '100%'
    player.style.height = '100%'
    frame.contentDocument!.body.appendChild(player)
    player.addEventListener('loadedmetadata', () => this.emit('loaded', undefined), { once: true })
    player.addEventListener(
      'loadeddata',
      () => requestAnimationFrame(() => !this.disposed && this.player === player && this.emit('firstFrame', undefined)),
      { once: true }
    )
    try {
      await player.ruffle().load({ data: build.bytes, swfFileName: `${build.name}.preview.swf`, allowScriptAccess: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.emit('error', msg)
      throw new Error(msg)
    }
  }

  dispose(): void {
    this.disposed = true
    this.offTap?.()
    this.frame?.remove()
    this.element.remove()
    Object.values(this.subs).forEach((s) => s.clear())
  }
}

// ---- trace channel (docs/debugging.md) ----
// Ruffle has no log API: it writes the movie's trace() output to the page console, as console.log('%cINFO%c web/src/log_adapter.rs:18%c <the trace text>', css, css, css)
// (Ruffle 0.7.1, pinned). We wrap console.log/info/debug once and hand on the trace text of those calls; a line that merely contains the marker `[Inkwell]` also counts.
const taps = new Set<(line: string) => void>()
const AVM_TRACE = /log_adapter\.rs:\d+%c([\s\S]*)$/
/** The trace text of one console call, or undefined when the call is something else. */
export function traceTextOf(args: readonly unknown[]): string | undefined {
  const first = typeof args[0] === 'string' ? args[0] : ''
  const m = AVM_TRACE.exec(first)
  if (m) return m[1]!.trim()
  return first.includes('[Inkwell]') ? first : undefined
}
let tapped = false
/** Hands the trace text of every log call of this console on to the taps. */
function tapConsole(c: Console): void {
  for (const level of ['log', 'info', 'debug'] as const) {
    const orig = c[level].bind(c)
    c[level] = (...args: unknown[]): void => {
      orig(...args)
      const text = traceTextOf(args)
      if (text !== undefined) taps.forEach((t) => t(text))
    }
  }
}
export function tapTrace(cb: (line: string) => void): () => void {
  taps.add(cb)
  if (!tapped) {
    tapped = true
    tapConsole(console)
  }
  return () => void taps.delete(cb)
}
