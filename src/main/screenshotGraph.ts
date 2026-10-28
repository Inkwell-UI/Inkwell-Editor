import { app, type BrowserWindow } from 'electron'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { createSession } from './session'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Debug only (`INKWELL_SHOTS_GRAPH=1` with `INKWELL_SHOTS_DIR` and `INKWELL_SHOTS_PROJECT=<scratch copy of samples/hud-graph>`): the graph UI states of
 * the Behaviour mode. It first removes the copy's graphs (the project is reopened empty), then puts them back. States: g1-graphs-empty, g1b-graph-created
 * (after + Graph), g2-slice (the slice graph open), g3-spawn-menu (Space), g3b-spawn-from-pin (a wire dropped on empty canvas), g4-node-issues (the layer
 * picker of Set Text cleared: required-pin badge), g4b-find (Ctrl+F), g5-variables, g6-binding (mock data field + binding), g7-graph-selected (a layer that
 * has a graph is selected in the Navigator). Checks the files on disk afterwards and prints them. Never run it on a project you care about.
 */
export async function runGraphShots(o: { outDir: string; projectDir: string; win: () => BrowserWindow | undefined; session: ReturnType<typeof createSession> }): Promise<void> {
  await mkdir(o.outDir, { recursive: true })
  const main = (): BrowserWindow => o.win()!
  const js = <T>(code: string): Promise<T> => main().webContents.executeJavaScript(code) as Promise<T>
  const snap = async (name: string): Promise<void> => {
    await wait(700)
    await writeFile(join(o.outDir, `${name}.png`), (await main().webContents.capturePage()).toPNG())
    console.log(`[shots] ${name}`)
  }
  const q = (sel: string): string => JSON.stringify(sel)
  const click = (sel: string): Promise<boolean> => js<boolean>(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return false; e.click(); return true })()`)
  const must = async (sel: string): Promise<void> => {
    if (!(await click(sel))) throw new Error(`Not found: ${sel}`)
  }
  const has = (sel: string): Promise<boolean> => js<boolean>(`!!document.querySelector(${q(sel)})`)
  const until = async (what: string, fn: () => boolean | Promise<boolean>, ms = 30000): Promise<void> => {
    const t0 = Date.now()
    while (!(await fn())) {
      if (Date.now() - t0 > ms) throw new Error(`Timed out waiting for ${what}`)
      await wait(150)
    }
  }
  /** Sets a React-controlled input/select the way a user's change does. */
  const setValue = (sel: string, value: string): Promise<boolean> =>
    js<boolean>(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return false; const proto = e instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event(e instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); return true })()`)
  /** Types like a user: focus, set, input event, blur (the mock data boxes commit on blur). */
  const typeInto = (sel: string, value: string): Promise<boolean> =>
    js<boolean>(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return false; e.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input', { bubbles: true })); e.blur(); return true })()`)
  const key = (keyCode: string, modifiers: ('control' | 'shift')[] = []): void => {
    for (const type of ['keyDown', 'keyUp'] as const) main().webContents.sendInputEvent({ type, keyCode, modifiers })
  }
  const centerOf = (sel: string): Promise<{ x: number; y: number }> =>
    js(`(() => { const r = document.querySelector(${q(sel)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
  const hover = async (sel: string, dx = 0, dy = 0): Promise<{ x: number; y: number }> => {
    const c = await centerOf(sel)
    main().webContents.sendInputEvent({ type: 'mouseMove', x: c.x + dx, y: c.y + dy })
    await wait(200)
    return { x: c.x + dx, y: c.y + dy }
  }

  main().setContentSize(1600, 960)
  main().center()
  const graphDir = join(o.projectDir, 'swfs', 'hud', 'graphs')
  const keep = join(o.projectDir, '..', `${Date.now()}-graphs-backup`)
  await cp(graphDir, keep, { recursive: true })
  await rm(graphDir, { recursive: true, force: true })
  let r = await o.session.open(o.projectDir)
  if (!r.ok) throw new Error(`open failed: ${JSON.stringify(r)}`)
  await wait(2500)
  key('2', ['control']) // Behaviour
  await until('graph panel', () => has('[data-panel="graph"]'))
  await until('empty graph state', () => has('[data-testid="graph-empty"]'))
  await snap('g1-graphs-empty')

  await must('[data-testid="graph-add-nav"]') // creates the menu graph
  await until('new graph', () => has('[data-testid="graph-canvas"]'))
  await snap('g1b-graph-created')
  console.log('[shots] overlay scripts after + Graph:', JSON.stringify(JSON.parse(await readFile(join(o.projectDir, 'swfs', 'hud', 'overlay.json'), 'utf8')).nodes))

  // back to the slice graph on disk, reopen
  await rm(graphDir, { recursive: true, force: true })
  await cp(keep, graphDir, { recursive: true })
  // a node of a pack that is not installed, wired to the Branch's false output: it must render as `Unknown Pack Node (Data Preserved)`
  const file = join(graphDir, 'main.json')
  const doc = JSON.parse(await readFile(file, 'utf8')) as { nodes: unknown[]; edges: unknown[] }
  doc.nodes.push({ id: 'ghost', kind: 'acme/Ghost@2', fields: { keep: 'me' }, pos: { x: 520, y: 220 } })
  doc.edges.push({ from: { node: 'branch', pin: 'false' }, to: { node: 'ghost', pin: 'in' } })
  await writeFile(file, JSON.stringify(doc, null, 2))
  r = await o.session.open(o.projectDir)
  if (!r.ok) throw new Error(`reopen failed: ${JSON.stringify(r)}`)
  main().webContents.reload() // the renderer keeps its graph stores while the same project stays open
  await wait(3500)
  await until('slice graph', () => has('[data-testid="node-core/SetText@1"]'))
  await wait(800)
  await snap('g2-slice')

  // Space: spawn menu at the pointer
  const at = await hover('[data-testid="graph-canvas"]', 120, 140)
  await js(`document.querySelector('[data-testid="graph-canvas"]').focus()`)
  key('Space')
  await until('spawn menu', () => has('.kw-spawn'))
  await snap('g3-spawn-menu')
  main().webContents.insertText('branch')
  await wait(300)
  await snap('g3-spawn-menu-search')
  key('Escape')
  await wait(300)

  // drop a wire from the Log node's Exec output on empty canvas: the menu only offers Exec inputs
  const out = await js<{ x: number; y: number } | null>(`(() => { const n = document.querySelector('[data-testid="node-core/Log@1"] .gn-handle[data-pin="Exec"].source'); if (!n) return null; const r = n.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
  if (out) {
    const w = main().webContents
    w.sendInputEvent({ type: 'mouseMove', x: out.x, y: out.y })
    w.sendInputEvent({ type: 'mouseDown', x: out.x, y: out.y, button: 'left', clickCount: 1 })
    for (let i = 1; i <= 6; i++) {
      w.sendInputEvent({ type: 'mouseMove', x: out.x + i * 12, y: out.y + 40 + i * 10, button: 'left', modifiers: ['leftButtonDown'] } as never)
      await wait(40)
    }
    w.sendInputEvent({ type: 'mouseUp', x: out.x + 72, y: out.y + 100, button: 'left', clickCount: 1 })
    await wait(500)
    if (await has('.kw-spawn')) {
      await snap('g3b-spawn-from-pin')
      key('Escape')
    } else console.log('[shots] no spawn menu after the wire drop')
  } else console.log('[shots] Log node output handle not found')
  void at

  // clear the Set Text target: a required-input error badge on the node
  await setValue('[data-testid="node-core/SetText@1"] [data-testid="layer-picker"]', '')
  await until('issue badge', () => has('[data-testid="node-core/SetText@1"] [data-testid="node-badge"]'), 10000)
  await snap('g4-node-issues')
  console.log('[shots] badge:', await js<string>(`document.querySelector('[data-testid="node-core/SetText@1"] [data-testid="node-badge"]').getAttribute('aria-label')`))
  // restore it through the picker (an undoable edit too)
  await setValue('[data-testid="node-core/SetText@1"] [data-testid="layer-picker"]', '2:4')
  await wait(500)

  // select a node with a real click: the Inspector shows the graph node and its target layer is selected in the Navigator (one selection model)
  const clickAt = (p: { x: number; y: number }): void => {
    main().webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y })
    main().webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 })
    main().webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 })
  }
  clickAt(await centerOf('[data-testid="node-core/SetText@1"] .gn-head'))
  await until('graph node inspector', () => has('[data-testid="graph-node-inspector"]'), 10000)
  await snap('g8-node-inspector')
  console.log('[shots] selected layer row after node click:', await js<string>(`document.querySelector('.layer-row.is-selected .layer-name')?.textContent ?? '(none)'`))

  await js(`document.querySelector('[data-testid="event-item-call"]').click()`) // the event list selects and centres the event node
  await wait(500)
  console.log('[shots] event jump selected:', await js<string>(`document.querySelector('.gn.is-selected .gn-title')?.textContent ?? '(none)'`))
  console.log('[shots] nodes mounted after the jump (only visible ones are):', await js<number>(`document.querySelectorAll('.react-flow__node').length`))
  await must('.react-flow__controls-fitview')
  await wait(600)

  // a drag is one undo entry: move Log by hand, Ctrl+Z once, it is back
  const posOf = (): Promise<string> => js<string>(`document.querySelector('[data-testid="node-core/Log@1"]').closest('.react-flow__node').style.transform`)
  const before = await posOf()
  const head = await centerOf('[data-testid="node-core/Log@1"] .gn-head')
  const w = main().webContents
  w.sendInputEvent({ type: 'mouseMove', x: head.x, y: head.y })
  w.sendInputEvent({ type: 'mouseDown', x: head.x, y: head.y, button: 'left', clickCount: 1 })
  for (let i = 1; i <= 8; i++) {
    w.sendInputEvent({ type: 'mouseMove', x: head.x + i * 8, y: head.y + i * 5, button: 'left', modifiers: ['leftButtonDown'] } as never)
    await wait(40) // React Flow applies drag moves on animation frames
  }
  w.sendInputEvent({ type: 'mouseUp', x: head.x + 64, y: head.y + 40, button: 'left', clickCount: 1 })
  await wait(400)
  const moved = await posOf()
  key('Z', ['control'])
  await wait(400)
  const undone = await posOf()
  console.log('[shots] drag: before', before, 'moved', moved, 'after one Ctrl+Z', undone, before === undone && moved !== before ? 'OK' : 'FAILED')
  key('Y', ['control'])
  await wait(300)

  // Ctrl+F
  await js(`document.querySelector('[data-testid="graph-canvas"]').focus()`)
  key('F', ['control'])
  await until('find bar', () => has('.kw-find'))
  main().webContents.insertText('log')
  await wait(300)
  await snap('g4b-find')
  key('Escape')
  await wait(300)

  // Variables panel (left tab)
  await must('[data-testid="tab-variables"]')
  await wait(300)
  await setValue('[data-testid="var-name"]', 'score')
  await setValue('[data-testid="var-type"]', 'Number')
  await must('[data-testid="var-add"]')
  await setValue('[data-testid="var-name"]', 'visible flag')
  await setValue('[data-testid="var-type"]', 'Bool')
  await must('[data-testid="var-add"]')
  await wait(500)
  await snap('g5-variables')

  // Data binding: a mock field, then bind the subtitle layer
  await must('[data-testid="tab-navigator"]')
  await wait(300)
  await must('[data-testid="tab-mockData"]')
  await wait(300)
  await must('[data-testid="mock-add"]')
  await wait(400)
  await typeInto('[data-testid="mock-field1"] input[aria-label="Mock data value"]', 'Hello Dragonborn')
  await typeInto('[data-testid="mock-field1"] input[aria-label="Mock data key"]', 'greeting')
  await wait(400)
  await must('[data-testid="mock-add"]')
  await wait(300)
  await snap('g6a-mock-data')
  await must('[data-layer-id="2:5"]')
  await must('[data-testid="tab-dataBinding"]')
  await wait(400)
  await setValue('[data-testid="bind-text"]', 'var:score')
  await setValue('[data-testid="bind-visible"]', 'var:visible-flag')
  await wait(500)
  await snap('g6-binding')

  // selecting a layer that has a graph opens it
  await must('[data-layer-id="2:4"]')
  await wait(500)
  await snap('g7-layer-selected')

  await wait(800) // saves are debounced
  console.log('[shots] overlay.json:', await readFile(join(o.projectDir, 'swfs', 'hud', 'overlay.json'), 'utf8'))
  const g = JSON.parse(await readFile(join(graphDir, 'main.json'), 'utf8')) as { variables: unknown[]; nodes: { id: string; fields: unknown }[] }
  console.log('[shots] graph variables:', JSON.stringify(g.variables), 'settext fields:', JSON.stringify(g.nodes.find((n) => n.id === 'settext')?.fields))
  app.exit(0)
}

/**
 * Debug only (`INKWELL_SHOTS_GRAPH=debug` + `INKWELL_SHOTS_DIR` + `INKWELL_SHOTS_PROJECT=<scratch copy of samples/hud-graph>`, and `INKWELL_CORE_PACK=<core pack
 * copy plus tests/fixtures/packs/throw-node>`): Phase 6 end to end in the real Ruffle preview inside Electron (docs/debugging.md, Verifying). It rewrites the
 * copy's graph (a Throw entry `Boom`, a variable bound to the subtitle, Set Variable after the Log) and overlay (binding, mock data), then: AS2 split view
 * (node -> lines, line -> node, live update after an edit, timing of that edit to the new preview), Play panel (Show("Hello Ruffle") and Boom), Runtime Trace
 * panel (lines, click selects the node), pin value badges, mock data, a Lint row opening its graph node. Prints what it saw; states d0-start ... d9-lint-click.
 * Never run it on a project you care about.
 */
export async function runDebugShots(o: { outDir: string; projectDir: string; win: () => BrowserWindow | undefined; session: ReturnType<typeof createSession> }): Promise<void> {
  await mkdir(o.outDir, { recursive: true })
  const main = (): BrowserWindow => o.win()!
  const js = <T>(code: string): Promise<T> => main().webContents.executeJavaScript(code) as Promise<T>
  const snap = async (name: string): Promise<void> => {
    await wait(700)
    await writeFile(join(o.outDir, `${name}.png`), (await main().webContents.capturePage()).toPNG())
    console.log(`[debug] shot ${name}`)
  }
  const q = (sel: string): string => JSON.stringify(sel)
  const has = (sel: string): Promise<boolean> => js<boolean>(`!!document.querySelector(${q(sel)})`)
  const click = (sel: string): Promise<boolean> => js<boolean>(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return false; e.click(); return true })()`)
  const must = async (sel: string): Promise<void> => {
    if (!(await click(sel))) throw new Error(`Not found: ${sel}`)
  }
  const text = (sel: string): Promise<string> => js<string>(`document.querySelector(${q(sel)})?.textContent ?? ''`)
  const count = (sel: string): Promise<number> => js<number>(`document.querySelectorAll(${q(sel)}).length`)
  const timing = (): Promise<string> => text('[data-testid="timing"]')
  const until = async (what: string, fn: () => boolean | Promise<boolean>, ms = 30000): Promise<void> => {
    const t0 = Date.now()
    while (!(await fn())) {
      if (Date.now() - t0 > ms) {
        await snap('dfail').catch(() => undefined)
        throw new Error(`Timed out waiting for ${what} (status bar: ${await timing().catch(() => '?')})`)
      }
      await wait(100)
    }
  }
  const setValue = (sel: string, value: string): Promise<boolean> =>
    js<boolean>(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return false; const proto = e instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event(e instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); return true })()`)
  const key = (keyCode: string, modifiers: ('control' | 'shift')[] = []): void => {
    for (const type of ['keyDown', 'keyUp'] as const) main().webContents.sendInputEvent({ type, keyCode, modifiers })
  }
  const check = (what: string, ok: boolean, detail = ''): void => console.log(`[debug] ${ok ? 'OK    ' : 'FAILED'} ${what}${detail ? `: ${detail}` : ''}`)
  const realClick = async (sel: string): Promise<void> => {
    const p = await js<{ x: number; y: number }>(`(() => { const r = document.querySelector(${q(sel)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
    main().webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y })
    main().webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 })
    main().webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 })
  }
  const lines = (): Promise<string[]> => js<string[]>(`[...document.querySelectorAll('[data-testid="trace-lines"] li')].map((e) => e.textContent)`)
  const selectedTitle = (): Promise<string> => text('.gn.is-selected .gn-title')

  // ---- the scratch project: Boom (throws), a variable bound to the subtitle, Set Variable after the Log, mock data
  const file = join(o.projectDir, 'swfs', 'hud', 'graphs', 'main.json')
  const g = JSON.parse(await readFile(file, 'utf8')) as { nodes: unknown[]; edges: unknown[]; variables: unknown[] }
  if (!JSON.stringify(g.nodes).includes('"boom"')) {
    g.nodes.push(
      { id: 'boom', kind: 'core/OnWidgetCall@1', fields: { name: 'Boom', params: [] }, pos: { x: 0, y: 380 } },
      { id: 'throw', kind: 'core/Throw@1', fields: { message: 'deliberate error' }, pos: { x: 260, y: 380 } },
      { id: 'setgreet', kind: 'core/SetVariable@1', fields: { variable: 'greeting' }, pos: { x: 1040, y: 0 } }
    )
    g.edges.push(
      { from: { node: 'boom', pin: 'then' }, to: { node: 'throw', pin: 'in' } },
      { from: { node: 'log', pin: 'then' }, to: { node: 'setgreet', pin: 'in' } },
      { from: { node: 'call', pin: 'title' }, to: { node: 'setgreet', pin: 'value' } }
    )
    g.variables.push({ id: 'greeting', name: 'greeting', type: 'String', scope: 'menu', default: 'hi' })
    await writeFile(file, JSON.stringify(g, null, 2))
    const ofile = join(o.projectDir, 'swfs', 'hud', 'overlay.json')
    const ov = JSON.parse(await readFile(ofile, 'utf8')) as { nodes: Record<string, Record<string, unknown>>; mockData?: unknown }
    ov.nodes['2:5'] = { ...ov.nodes['2:5'], dataBinding: 'text=var:greeting' }
    ov.mockData = { greeting: 'Mock says hi' }
    await writeFile(ofile, JSON.stringify(ov, null, 2))
  }

  main().webContents.on('console-message', (...a: unknown[]) => {
    const e = a[0] as { level?: unknown; message?: string }
    const level = typeof e?.level === 'string' ? e.level : a[1]
    const msg = e?.message ?? String(a[2])
    if (level === 'error' || level === 'warning' || level === 2 || level === 3) console.log(`[renderer ${String(level)}]`, msg.slice(0, 600))
  })
  main().setContentSize(1700, 1000)
  main().center()
  // every console line the page writes (what Ruffle logs for trace()) is kept in window.__con for the report
  await js(`window.__con = []; for (const l of ['log', 'info', 'debug', 'warn']) { const o = console[l].bind(console); console[l] = (...a) => { window.__con.push(l + ': ' + a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')); o(...a) } }; 0`)
  const fit = async (): Promise<void> => (await click('.react-flow__controls-fitview'), await wait(600))
  const r = await o.session.open(o.projectDir)
  if (!r.ok) throw new Error(`open failed: ${JSON.stringify(r)}`)
  o.session.debug.seedBuilds()
  await wait(1500)
  key('2', ['control']) // Behaviour
  await until('graph canvas', () => has('[data-testid="graph-canvas"]'))
  await until('Ruffle preview built and drawn', async () => (await timing()).includes('Render'), 60000)
  console.log('[debug] first build:', await timing())
  await wait(1500)
  await snap('d0-start')
  const get = (path: string): Promise<string> => js<string>(`String(document.querySelector('ruffle-player').inkwellGet(${JSON.stringify(path)}))`)
  console.log('[debug] movie before any call: title.text =', JSON.stringify(await get('Hud.title.text')), ' subtitle.text =', JSON.stringify(await get('Hud.subtitle.text')), '(subtitle is bound to variable greeting, mock data greeting = "Mock says hi")')
  const warns = (): Promise<number> => js<number>(`window.__con.filter((l) => l.includes('WARN')).length`)
  console.log('[debug] Ruffle warnings after load:', await warns())

  // ---- 6.1 AS2 split view
  await must('[data-testid="as2-split"]')
  await until('as2 code', () => has('[data-testid="as2-code"]'))
  const n0 = await count('.as2-line')
  check('AS2 split shows the generated class', n0 > 20 && (await text('[data-testid="as2-code"]')).includes('class mods.InkwellGraphTest.HudGraph_main'), `${n0} lines`)
  await realClick('[data-testid="node-core/SetText@1"] .gn-head')
  await until('highlighted lines', async () => (await count('.as2-line.is-hit')) > 0, 10000)
  const hit = await js<string[]>(`[...document.querySelectorAll('.as2-line.is-hit')].map((e) => e.textContent)`)
  check('selecting Set Text highlights its lines', hit.some((l) => l.includes('.text = ')), JSON.stringify(hit))
  await snap('d1-split-node-selected')
  const logLine = await js<number>(`[...document.querySelectorAll('.as2-line.is-mapped')].findIndex((e) => e.textContent.includes('trace("[Inkwell] info'))`)
  await js(`document.querySelectorAll('.as2-line.is-mapped')[${logLine}].click()`)
  await wait(700)
  check('clicking an AS2 line selects its node', (await selectedTitle()) === 'Log', await selectedTitle())
  await snap('d2-split-line-clicked')

  // ---- 6.2 Play panel (a taller preview strip: focus the splitter between preview and graph, ArrowDown)
  await js(`document.querySelector('.splitter-row').focus()`)
  for (let i = 0; i < 6; i++) key('Down')
  await wait(500)
  await must('[data-testid="tab-play"]')
  await until('play panel', () => has('[data-testid="play-panel"]'))
  await setValue('[data-testid="play-entry"]', 'main/call')
  await wait(300)
  await setValue('[data-testid="play-param-title"]', 'Hello Ruffle')
  await wait(200)
  await snap('d3-play-before-call')
  await must('[data-testid="play-call"]')
  await wait(1200)
  console.log('[debug] Ruffle warnings after the Show call:', await warns())
  const t1 = await get('Hud.title.text')
  const s1 = await get('Hud.subtitle.text')
  check('Show("Hello Ruffle") changed the title text in the movie (Set Text)', t1 === 'Hello Ruffle', JSON.stringify(t1))
  check('the bound subtitle followed Set Variable greeting', s1 === 'Hello Ruffle', JSON.stringify(s1))
  await js(`(() => { const z = document.querySelector('.zoom button:last-child'); for (let i = 0; i < 6; i++) z?.click() })()`)
  await wait(500)
  await js(`(() => { const s = document.querySelector('.stage-scroll'); const h = document.querySelector('.ruffle-host').getBoundingClientRect(); const r = s.getBoundingClientRect(); s.scrollLeft += h.right - r.right + 10; s.scrollTop += h.top - r.top - 4 })()`)
  await snap('d4b-zoomed-widget')
  await js(`(() => { const z = document.querySelector('.zoom-value'); z?.click() })()`)
  console.log('[debug] play result:', await text('[data-testid="play-result"]'))
  await snap('d4-play-after-call')
  check('Show called in the movie', (await text('[data-testid="play-result"]')).includes('Called Show("Hello Ruffle")'))

  // ---- 6.3 trace panel
  await must('[data-testid="tab-trace"]')
  await until('trace lines', async () => (await count('[data-testid="trace-lines"] li')) > 0, 8000).catch(() => undefined)
  const traced = await lines()
  console.log('[debug] console as the page saw it (last 12):', JSON.stringify((await js<string[]>('window.__con')).slice(-12)))
  console.log('[debug] trace lines:', JSON.stringify(traced))
  check('Log node line arrived with its node id', traced.some((l) => l.includes('INFO') && l.includes('#log') && l.includes('shown')))
  check('timestamp is shown', traced.some((l) => /^\[\d\d:\d\d:\d\d\.\d{3}\]/.test(l)))
  check('Ruffle notice is shown', (await text('[data-testid="trace-notice"]')).includes('not the game'))
  // the graph needs room for the pin badges: preview strip back to its size, AS2 split closed
  await js(`document.querySelector('.splitter-row').focus()`)
  for (let i = 0; i < 6; i++) key('Up')
  await must('[data-testid="as2-split"]')
  await wait(500)
  await fit()
  const pins = await js<string[]>(`[...document.querySelectorAll('[data-testid="pin-value"]')].map((e) => e.closest('.gn').querySelector('.gn-title').textContent + ' = ' + e.textContent)`)
  console.log('[debug] pin badges:', JSON.stringify(pins))
  check('pin value badges on the canvas', pins.length >= 2)
  await snap('d5-trace-and-pins')
  await realClick('[data-testid="node-core/SetText@1"] .gn-head')
  await wait(400)
  await js(`document.querySelector('.trace-line.is-link').click()`)
  await wait(600)
  check('clicking a trace line selects the node', (await selectedTitle()) === 'Log', await selectedTitle())

  // ---- the deliberate error: Boom throws, the widget keeps working
  await must('[data-testid="tab-play"]')
  await wait(300)
  await setValue('[data-testid="play-entry"]', 'main/boom')
  await wait(300)
  await must('[data-testid="play-call"]')
  await wait(800)
  await must('[data-testid="tab-trace"]')
  await wait(500)
  const after = await lines()
  check('Boom: the failing node id is traced as an error', after.some((l) => l.includes('ERROR') && l.includes('#throw') && l.includes('deliberate error')), JSON.stringify(after.slice(-2)))
  await snap('d6-error-trace')
  await must('[data-testid="tab-play"]')
  await setValue('[data-testid="play-entry"]', 'main/call')
  await wait(300)
  await setValue('[data-testid="play-param-title"]', 'Still alive')
  await wait(200)
  await must('[data-testid="play-call"]')
  await wait(1200)
  await must('[data-testid="tab-trace"]')
  await wait(400)
  const last = await lines()
  check('after the error the widget still works (Show("Still alive") logged again)', last.filter((l) => l.includes('#log') && l.includes('shown')).length >= 2, `${last.length} lines`)
  await snap('d7-after-error')

  // ---- live update + edit-to-preview time: change the Log message in the canvas
  await must('[data-testid="as2-split"]')
  await until('as2 code again', () => has('[data-testid="as2-code"]'))
  await fit()
  const before = await timing()
  const t0 = Date.now()
  await js(`(() => { const e = document.querySelector('[data-testid="node-core/Log@1"] input[type="text"], [data-testid="node-core/Log@1"] .gn-inline input'); e.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, 'edited!'); e.dispatchEvent(new Event('input', { bubbles: true })); e.blur() })()`)
  await until('as2 shows the edit', async () => (await text('[data-testid="as2-code"]')).includes('edited!'), 10000)
  check('AS2 view followed the edit', true, `${Date.now() - t0} ms`)
  await until('new build timing', async () => { const t = await timing(); return t !== before && t.includes('Render') }, 20000)
  console.log(`[debug] graph edit to the new preview frame: ${Date.now() - t0} ms wall clock; status bar: ${await timing()}`)
  await wait(500)
  await must('[data-testid="tab-play"]')
  await setValue('[data-testid="play-entry"]', 'main/call')
  await wait(200)
  await setValue('[data-testid="play-param-title"]', 'After edit')
  await wait(200)
  await must('[data-testid="play-call"]')
  await wait(800)
  await must('[data-testid="tab-trace"]')
  await wait(300)
  const edited = await lines()
  check('the rebuilt preview runs the edited graph', edited.slice(-3).some((l) => l.includes('edited!')), JSON.stringify(edited.slice(-2)))
  await snap('d8-edited')

  // ---- 6.4 a Lint row for a graph issue opens the graph and selects the node
  await fit()
  await setValue('[data-testid="node-core/SetText@1"] [data-testid="layer-picker"]', '')
  await until('graph lint row', async () => (await text('[data-testid="lint-counts"]')).match(/[1-9]/) !== null, 15000)
  await must('[data-testid="tab-lintBudget"]')
  await wait(500)
  await fit()
  await realClick('[data-testid="node-core/Log@1"] .gn-head')
  await wait(300)
  await js(`[...document.querySelectorAll('.lint-table tr.is-link')].find((r) => r.textContent.includes('graph-required-pin'))?.click()`)
  await wait(900)
  check('Lint row selected the graph node', (await selectedTitle()) === 'Set Text', await selectedTitle())
  await snap('d9-lint-click')
  await wait(500)
  app.exit(0)
}
