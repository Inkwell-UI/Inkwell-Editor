// UI state of the game dev connection: the store (session reset, lossy pins, watch table order, caps), the Game dot's label and tone, the popover and the Trace & Watch panel rendered to markup.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { devTone, initialDevState, type DevPhase, type DevState } from '../../shared/devLink'
import { GameDetails, gameLabel } from '../shell/GameDot'
import { TracePanel } from '../panels/TracePanel'
import { MAX_GAME_LINES, sortedWatch, useDevStore } from './devStore'
import { useTraceStore } from './traceStore'
import { strings } from '../strings'

const connected = (over: Partial<DevState> = {}): DevState => ({
  ...initialDevState(), phase: 'connected', session: 1, tokenSource: 'editor', tokenMasked: 'ab12...ef90', port: 8788,
  runtime: { versionString: '0.3.0', packed: 196608, gameVersion: '1.6.1170', protocol: 1, spec: 6 },
  menus: [{ name: 'T_Wheel', swf: 'Interface/Inkwell/T/Wheel.swf', open: true }, { name: 'T_Other', swf: 'x.swf', open: false }], ...over
})
// react-dom/server renders zustand stores from their INITIAL state object; copy the current state into it before rendering
const markup = (el: Parameters<typeof renderToStaticMarkup>[0]): string => {
  for (const store of [useDevStore, useTraceStore]) Object.assign(store.getInitialState(), store.getState())
  return renderToStaticMarkup(el)
}
beforeEach(() => {
  useDevStore.setState({ dev: initialDevState(), source: 'ruffle', lines: [], watch: {}, pins: {}, seen: false })
  useTraceStore.getState().clear()
})

describe('Game dot states (UX 4.6 Zone 6B)', () => {
  const tone = (phase: DevPhase, specMismatch = false) => devTone({ phase, specMismatch })
  it('grey: off, no token, waiting; amber: connecting, busy, spec difference; green: connected; red: refused', () => {
    for (const p of ['off', 'noToken', 'waiting'] as const) expect(tone(p)).toBe('off')
    for (const p of ['connecting', 'busy'] as const) expect(tone(p)).toBe('warn')
    expect(tone('connected')).toBe('ok')
    expect(tone('connected', true)).toBe('warn')
    for (const p of ['unauthorized', 'protocolMismatch', 'refused'] as const) expect(tone(p)).toBe('error')
  })
  it('every phase has its own label; a spec difference says so', () => {
    const phases: DevPhase[] = ['off', 'noToken', 'waiting', 'connecting', 'connected', 'unauthorized', 'protocolMismatch', 'refused', 'busy']
    expect(new Set(phases.map((p) => gameLabel({ phase: p, specMismatch: false }))).size).toBe(phases.length)
    expect(gameLabel({ phase: 'connected', specMismatch: true })).toBe(strings.dev.specMismatch)
  })
  it('the popover shows runtime and game version, the menus with their open state, and the masked token with its source - never a full token', () => {
    useDevStore.getState().setState(connected())
    const html = markup(createElement(GameDetails))
    expect(html).toContain('0.3.0')
    expect(html).toContain('1.6.1170')
    expect(html).toContain('T_Wheel')
    expect(html).toContain(strings.dev.menuOpen)
    expect(html).toContain('ab12...ef90')
    expect(html).toContain(strings.dev.tokenSources['editor']!)
    expect(html).toContain('type="password"') // the paste field hides what is typed
    expect(html).not.toMatch(/[0-9a-f]{64}/)
  })
  it('a refusal shows its message and offers Connect; connected offers Disconnect and hot reload', () => {
    useDevStore.getState().setState({ ...initialDevState(), phase: 'unauthorized', message: 'The game refused the token.' })
    const refused = markup(createElement(GameDetails))
    expect(refused).toContain('The game refused the token.')
    expect(refused).toContain('data-testid="game-connect"')
    useDevStore.getState().setState(connected())
    const ok = markup(createElement(GameDetails))
    expect(ok).toContain('data-testid="game-disconnect"')
    expect(ok).not.toContain('data-testid="game-connect"')
  })
  it('no token yet says how to get one (UX 5.4)', () => {
    useDevStore.getState().setState({ ...initialDevState(), phase: 'noToken' })
    expect(markup(createElement(GameDetails))).toContain(strings.dev.noTokenHelp)
  })
})

describe('dev store', () => {
  it('a new session clears pins and watch values but keeps the trace and adds a marker; a drop keeps everything', () => {
    const s = useDevStore.getState()
    s.setState(connected())
    s.apply([
      { k: 'pin', menu: 'M', node: 'n1', pin: 'value', value: 3 }, { k: 'watch', menu: 'M', graph: 'g', scope: 'menu', name: 'score', value: 5 },
      { k: 'trace', at: 1, ts: 1, level: 'info', source: 'as2', node: 'n1', text: 'hi' }
    ])
    expect(useDevStore.getState().pins).toEqual({ 'n1.value': '3' })
    s.setState({ ...connected(), phase: 'waiting', menus: [] }) // the game closed
    expect(Object.keys(useDevStore.getState().watch)).toHaveLength(1)
    expect(useDevStore.getState().lines).toHaveLength(2) // marker + trace
    s.setState(connected({ session: 2 }))
    expect(useDevStore.getState().pins).toEqual({})
    expect(useDevStore.getState().watch).toEqual({})
    expect(useDevStore.getState().lines.length).toBe(3)
  })
  it('keeps the latest value per pin and per variable, strings quoted', () => {
    const s = useDevStore.getState()
    s.apply([{ k: 'pin', menu: 'M', node: 'a', pin: 'out', value: 'x' }, { k: 'pin', menu: 'M', node: 'a', pin: 'out', value: 'y' }, { k: 'watch', menu: 'M', graph: 'g', scope: 'saved', name: 'n', value: 1 }, { k: 'watch', menu: 'M', graph: 'g', scope: 'saved', name: 'n', value: 2 }])
    expect(useDevStore.getState().pins).toEqual({ 'a.out': '"y"' })
    expect(Object.values(useDevStore.getState().watch).map((w) => w.value)).toEqual(['2'])
  })
  it('orders the watch table Component, Menu, Saved and caps the lines', () => {
    const s = useDevStore.getState()
    s.apply([
      { k: 'watch', menu: 'M', graph: 'g', scope: 'saved', name: 'b', value: 1 }, { k: 'watch', menu: 'M', graph: 'g', scope: 'component', name: 'z', value: 1 },
      { k: 'watch', menu: 'M', graph: 'g', scope: 'menu', name: 'a', value: 1 }, { k: 'watch', menu: 'M', graph: 'g', scope: 'menu', name: 'A0', value: 1 }
    ])
    expect(sortedWatch(useDevStore.getState().watch).map((w) => `${w.scope}:${w.name}`)).toEqual(['component:z', 'menu:a', 'menu:A0', 'saved:b'])
    s.apply(Array.from({ length: MAX_GAME_LINES + 30 }, (_, i) => ({ k: 'trace' as const, at: i, ts: i, level: 'info' as const, source: 'as2' as const, text: String(i) })))
    expect(useDevStore.getState().lines).toHaveLength(MAX_GAME_LINES)
    expect(useDevStore.getState().lines.at(-1)!.text).toBe(String(MAX_GAME_LINES + 29))
  })
  it('runtime errors become warning lines', () => {
    useDevStore.getState().apply([{ k: 'error', at: 5, code: 'unknown-menu', message: 'no menu X' }])
    expect(useDevStore.getState().lines[0]).toMatchObject({ level: 'warn', text: '[unknown-menu] no menu X' })
  })
  it('Clear empties lines, watch and pins', () => {
    const s = useDevStore.getState()
    s.apply([{ k: 'pin', menu: 'M', node: 'a', pin: 'o', value: 1 }, { k: 'trace', at: 1, ts: 1, level: 'info', source: 'as2', text: 'x' }])
    s.clear()
    expect(useDevStore.getState()).toMatchObject({ lines: [], watch: {}, pins: {} })
  })
})

describe('Trace & Watch panel', () => {
  const render = (): string => markup(createElement(TracePanel))
  it('Ruffle preview source is the default and keeps its notice', () => {
    const html = render()
    expect(html).toContain(strings.dev.sourceRuffle)
    expect(html).toContain(strings.trace.notice)
  })
  it('Game source, never connected: the empty state "Start Skyrim with Dev Mode enabled" and no hot reload', () => {
    useDevStore.getState().setSource('game')
    const html = render()
    expect(html).toContain('Start Skyrim with Dev Mode enabled')
    expect(html).toContain(strings.dev.gameNotice)
    expect(html).toContain(strings.dev.reloadNeedsGame) // Trigger Hot Reload carries its reason
  })
  it('Game source with a session: lines with level, source and node id, the watch table; disconnected it is greyed with a note', () => {
    const s = useDevStore.getState()
    s.setSource('game')
    s.setState(connected())
    s.apply([
      { k: 'trace', at: 1000, ts: 1, level: 'warn', source: 'as2', menu: 'T_Wheel', node: 'n84', text: 'coerced undefined input' },
      { k: 'watch', menu: 'T_Wheel', graph: 'main', scope: 'saved', name: 'sortPref', value: 'val' }
    ])
    let html = render()
    expect(html).toContain('coerced undefined input')
    expect(html).toContain('#n84')
    expect(html).toContain('WARN')
    expect(html).toContain('sortPref')
    expect(html).toContain('&quot;val&quot;')
    expect(html).toContain(strings.dev.watchScope['saved']!)
    expect(html).not.toContain('is-greyed')
    expect(html).toContain(strings.dev.connectedTip('0.3.0', 8788))
    s.setState({ ...connected(), phase: 'waiting' })
    html = render()
    expect(html).toContain('is-greyed')
    expect(html).toContain(strings.dev.greyedNote)
    expect(html).toContain('coerced undefined input') // the last session stays visible
  })
})
