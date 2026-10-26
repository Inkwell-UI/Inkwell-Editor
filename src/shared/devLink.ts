// The game dev connection (SPEC-CHANGES S6, docs/dev-mode.md): types shared by main (client), preload and renderer, plus the pure helpers the UI and the tests use.
// The token itself never appears in any of these types: the renderer only ever sees `tokenMasked`.

/**
 * - `off`: the user disconnected, or no project is open (grey)
 * - `noToken`: no token known yet; run a Dev deploy or paste one (grey, there may be no game and no dev mode at all)
 * - `waiting`: nothing listens on the port (the game is not running or dev mode is off); retrying quietly (grey)
 * - `connecting`: TCP is up, the hello is out (amber)
 * - `connected`: helloAck ok (green; amber with `specMismatch`)
 * - `unauthorized` / `protocolMismatch` / `refused` (HTTP 403: an Origin or Host the server does not accept): refused (red, no automatic retry: a retry cannot succeed and five bad tokens lock the server for 60 s)
 * - `busy`: another editor holds the connection (amber, slow retry)
 */
export type DevPhase = 'off' | 'noToken' | 'waiting' | 'connecting' | 'connected' | 'unauthorized' | 'protocolMismatch' | 'refused' | 'busy'
export type DevTone = 'ok' | 'warn' | 'error' | 'off'
export type TokenSource = 'none' | 'pasted' | 'overwrite' | 'deploy' | 'editor'

export interface DevMenu {
  name: string
  swf: string
  open: boolean
}

export interface DevRuntimeInfo {
  versionString: string
  packed: number
  gameVersion: string
  protocol: number
  spec: number
}

export interface DevState {
  phase: DevPhase
  port: number
  tokenSource: TokenSource
  /** `ab12...ef90`, never the token. */
  tokenMasked?: string
  /** Where the token was found (a file path), for the popover. */
  tokenFrom?: string
  runtime?: DevRuntimeInfo
  /** The runtime's spec version differs from the editor's: amber, still connected. */
  specMismatch: boolean
  menus: DevMenu[]
  /** One line for the popover/tooltip: why the phase is what it is. */
  message?: string
  /** Counts up on every successful hello: the renderer starts a fresh watch table and pin set for a new session. */
  session: number
  /** The project's Dev deploy toggle (settings, default off). */
  devDeploy: boolean
}

export const initialDevState = (): DevState => ({ phase: 'off', port: 8788, tokenSource: 'none', specMismatch: false, menus: [], session: 0, devDeploy: false })

export const devTone = (s: Pick<DevState, 'phase' | 'specMismatch'>): DevTone =>
  s.phase === 'connected' ? (s.specMismatch ? 'warn' : 'ok')
    : s.phase === 'connecting' || s.phase === 'busy' ? 'warn'
      : s.phase === 'unauthorized' || s.phase === 'protocolMismatch' || s.phase === 'refused' ? 'error'
        : 'off'

export type TraceSourceKind = 'as2' | 'runtime'
export type DevScope = 'component' | 'menu' | 'saved'
export type DevValue = boolean | number | string | null

/** What the runtime streams, as the renderer receives it (batched). `at` is the editor's clock when main received it. */
export type DevEvent =
  | { k: 'trace'; at: number; ts: number; level: 'trace' | 'debug' | 'info' | 'warn' | 'error'; source: TraceSourceKind; menu?: string; node?: string; graph?: string; text: string }
  | { k: 'watch'; menu: string; graph: string; scope: DevScope; name: string; value: DevValue }
  | { k: 'pin'; menu: string; node: string; pin: string; value: DevValue }
  | { k: 'menuState'; menu: string; open: boolean }
  | { k: 'error'; at: number; code: string; message: string }

export interface DevReloadResult {
  ok: boolean
  reloaded: string[]
  skipped: { name: string; reason: string }[]
  ms: number
  error?: string
}

/** `ab12...ef90` (S6: the runtime logs the same shape). Anything shorter than 12 characters is hidden completely. */
export const maskToken = (t: string): string => (t.length >= 12 ? `${t.slice(0, 4)}...${t.slice(-4)}` : '****')

/** Pin and watch values the way the preview shows them: strings quoted, a JSON string of an Array/Object (the runtime's form) as is. */
export function formatDevValue(v: DevValue): string {
  if (typeof v === 'string') return /^[[{]/.test(v) ? v : JSON.stringify(v)
  return String(v)
}

/** The hot reload line for the deploy status and the toast. */
export function reloadSummary(r: DevReloadResult): string {
  if (!r.ok) return `hot reload failed: ${r.error ?? 'unknown error'}`
  const skipped = r.skipped.length ? `, skipped ${r.skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}` : ''
  return `hot reload: ${r.reloaded.length ? `reloaded ${r.reloaded.join(', ')}` : 'nothing to reload'} in ${Math.round(r.ms)} ms${skipped}`
}
