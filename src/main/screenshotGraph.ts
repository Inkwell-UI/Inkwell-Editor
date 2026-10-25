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

  await setValue('[data-testid="event-jump"]', 'call') // the event jump list selects and centres the event node
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
