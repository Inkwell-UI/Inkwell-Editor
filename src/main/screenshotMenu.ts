import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { createSession } from './session'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Debug only (`INKWELL_SHOTS_MENU=1` + `INKWELL_SHOTS_DIR` + `INKWELL_SHOTS_PROJECT=<scratch copy of samples/menu-slice>`, optional `INKWELL_MO2_MODS=<folder you may overwrite>` for a real
 * deploy): the custom-menu slice in the real Ruffle preview and the real UI. The mock bridge starts the menu class, the Play panel clicks the button and the status text changes
 * and the Log line reaches the Trace panel; a real mouse click does the same; Close and Open do not break it; the Menu settings panel and dialog edit menu.json on disk;
 * Deploy writes the menu layout. States m0 ... m9. Prints OK/FAILED per check. Edits the project it is given: use a copy.
 */
export async function runMenuShots(o: { outDir: string; projectDir: string; win: () => BrowserWindow | undefined; session: ReturnType<typeof createSession> }): Promise<void> {
  await mkdir(o.outDir, { recursive: true })
  const main = (): BrowserWindow => o.win()!
  const js = <T>(code: string): Promise<T> => main().webContents.executeJavaScript(code) as Promise<T>
  const snap = async (name: string, ms = 400): Promise<void> => {
    await wait(ms)
    await writeFile(join(o.outDir, `${name}.png`), (await main().webContents.capturePage()).toPNG())
    console.log(`[menu] shot ${name}`)
  }
  const q = (sel: string): string => JSON.stringify(sel)
  const has = (sel: string): Promise<boolean> => js<boolean>(`!!document.querySelector(${q(sel)})`)
  const must = async (sel: string): Promise<void> => {
    if (!(await js<boolean>(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return false; e.click(); return true })()`))) throw new Error(`Not found: ${sel}`)
  }
  const text = (sel: string): Promise<string> => js<string>(`document.querySelector(${q(sel)})?.textContent ?? ''`)
  const until = async (what: string, fn: () => boolean | Promise<boolean>, ms = 30000): Promise<void> => {
    const t0 = Date.now()
    while (!(await fn())) {
      if (Date.now() - t0 > ms) throw new Error(`Timed out waiting for ${what}`)
      await wait(100)
    }
  }
  const setValue = (sel: string, value: string): Promise<boolean> =>
    js<boolean>(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return false; const proto = e instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event(e instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); return true })()`)
  const commit = (sel: string): Promise<boolean> => js<boolean>(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return false; e.focus(); e.blur(); return true })()`)
  const key = (keyCode: string, modifiers: ('control' | 'shift')[] = []): void => {
    for (const type of ['keyDown', 'keyUp'] as const) main().webContents.sendInputEvent({ type, keyCode, modifiers })
  }
  const check = (what: string, ok: boolean, detail = ''): void => console.log(`[menu] ${ok ? 'OK    ' : 'FAILED'} ${what}${detail ? `: ${detail}` : ''}`)
  const get = (path: string): Promise<string> => js<string>(`String(document.querySelector('ruffle-player').inkwellGet(${JSON.stringify(path)}))`)
  const lines = (): Promise<string[]> => js<string[]>(`[...document.querySelectorAll('[data-testid="trace-lines"] li')].map((e) => e.textContent)`)
  const menuJson = async (): Promise<Record<string, unknown>> => JSON.parse(await readFile(join(o.projectDir, 'swfs', 'menu', 'menu.json'), 'utf8')) as Record<string, unknown>

  main().setContentSize(1700, 1000)
  main().center()
  const r = await o.session.open(o.projectDir)
  if (!r.ok) throw new Error(`open failed: ${JSON.stringify(r)}`)
  o.session.debug.seedBuilds()
  await wait(1500)
  key('2', ['control']) // Behaviour
  await until('graph canvas', () => has('[data-testid="graph-canvas"]'))
  await until('Ruffle preview built and drawn', async () => (await text('[data-testid="timing"]')).includes('Render'), 60000)
  await wait(1500)

  // ---- the mock runtime started the menu class
  check('the mock bridge is installed and ready (_root.inkwell.ready)', (await get('inkwell.ready')) === 'true', await get('inkwell.ready'))
  check('the menu class ran start(): one graph instance on _root', (await get('inkwellMenu.graphs.length')) === '1', await get('inkwellMenu.graphs.length'))
  check('the status text starts as designed', (await get('status.text')) === 'Waiting for a click', await get('status.text'))
  await snap('m0-start')

  // ---- Play panel: click the button
  await must('[data-testid="tab-play"]')
  await until('play panel', () => has('[data-testid="play-menu"]'))
  await snap('m1-play-menu')
  await must('[data-testid="play-menu-click"]')
  await wait(500)
  check('Click: the Set Text of the graph changed the status text', (await get('status.text')) === 'Button clicked!', await get('status.text'))
  console.log('[menu] play result:', await text('[data-testid="play-menu-result"]'))
  await must('[data-testid="tab-trace"]')
  await wait(400)
  const tl = await lines()
  console.log('[menu] trace lines:', JSON.stringify(tl))
  check('the Log node reached the Trace panel through the bridge (node id log, message "button clicked")', tl.some((l) => l.includes('INFO') && l.includes('#log') && l.includes('button clicked')))
  check('no ERROR line in the trace', !tl.some((l) => l.includes('ERROR')))
  await snap('m2-clicked')

  // ---- Close and Open call onClose / onOpen like the runtime; the menu keeps working afterwards
  await must('[data-testid="tab-play"]')
  await must('[data-testid="play-menu-close"]')
  await wait(200)
  await must('[data-testid="play-menu-open"]')
  await wait(200)
  console.log('[menu] open/close result:', await text('[data-testid="play-menu-result"]'))
  check('Close then Open: no error', !(await text('[data-testid="play-menu-result"]')).includes('did not take'))

  // ---- UI scale (S9): the Play panel's control reopens the menu with inkwell.uiScale; the glue scales the root (150 %, centred), 1 puts it back
  await setValue('[data-testid="play-ui-scale"]', '1.5')
  await wait(500)
  check('UI scale 1.5: the glue scaled the menu root to 150 % around the centre', (await get('_xscale')) === '150' && (await get('_x')) === '-480' && (await get('_y')) === '-270', `${await get('_xscale')} at ${await get('_x')},${await get('_y')}`)
  check('UI scale 1.5: the menu class restarted and runs', (await get('inkwellMenu.graphs.length')) === '1')
  await snap('u1-ui-scale-150')
  await setValue('[data-testid="play-ui-scale"]', '0.5')
  await wait(500)
  check('UI scale 0.5: root at 50 %', (await get('_xscale')) === '50' && (await get('_x')) === '480', `${await get('_xscale')} at ${await get('_x')}`)
  await snap('u2-ui-scale-50')
  await must('[data-testid="stage-more"]') // the compact toolbar keeps the same control in its More menu
  await must('[data-testid="stage-ui-scale-btn"]') // the button opens the slider
  await until('UI scale in More', () => has('[data-testid="stage-ui-scale"]'))
  await setValue('[data-testid="stage-ui-scale"]', '0.75')
  await wait(500)
  check('UI scale 0.75 from the More menu: root at 75 %', (await get('_xscale')) === '75', await get('_xscale'))
  await snap('u3-ui-scale-more-menu')
  await must('[data-testid="stage-more"]')
  await setValue('[data-testid="play-ui-scale"]', '1')
  await wait(500)
  check('UI scale 1: the root is back at 100 %, 0,0', (await get('_xscale')) === '100' && (await get('_x')) === '0' && (await get('_y')) === '0')

  // ---- a real mouse click on the button in the preview (not the Play panel): reload the movie first so the text is back to the start
  await must('[data-testid="mode-play"]') // Play mode: clicks reach the movie (Inspect mode puts an overlay on top)
  await must('[data-testid="stage-reload"]')
  await wait(2500)
  const rect = await js<{ x: number; y: number; w: number; h: number } | null>(`(() => { const e = document.querySelector('ruffle-player'); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height } })()`)
  if (rect && (await get('status.text')) === 'Waiting for a click') {
    // the button's centre in stage px is (960, 485) in a 1920x1080 stage that fills the player
    const x = Math.round(rect.x + (960 / 1920) * rect.w)
    const y = Math.round(rect.y + (485 / 1080) * rect.h)
    for (let attempt = 0; attempt < 3 && (await get('status.text')) === 'Waiting for a click'; attempt++) { // the first events after a reload can be lost while Ruffle takes focus
      main().webContents.sendInputEvent({ type: 'mouseMove', x, y })
      await wait(300)
      main().webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
      await wait(120)
      main().webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
      await wait(700)
      if (attempt > 0) console.log('[menu] real click needed attempt', attempt + 1)
    }
    check('a real mouse click on the button runs the same graph', (await get('status.text')) === 'Button clicked!', `${await get('status.text')} (player ${JSON.stringify(rect)}, click ${x},${y})`)
    await snap('m3-real-click')
  } else console.log('[menu] SKIPPED real click: status was', await get('status.text'), 'player', JSON.stringify(rect))

  // ---- the settings button next to the SWF type opens the menu form as a dialog and edits menu.json
  key('1', ['control'])
  await wait(500)
  await must('[data-testid="target-pill"]')
  await until('menu settings form', () => has('.dialog [data-testid="menu-settings"]'))
  check('the form shows the stored values: depth 3, hotkey F8 (66), requires 0.3.0', (await js<string>(`document.querySelector('[data-testid="menu-depth"]').value`)) === '3' && (await js<string>(`document.querySelector('[data-testid="menu-key-code"]').value`)) === '66' && (await text('[data-testid="menu-requires"]')).includes('0.3.0'))
  check('the Gamepad combo is disabled with its reason', (await js<string>(`document.querySelector('[data-testid="menu-gamepad"]').getAttribute('aria-disabled') + '|' + document.querySelector('[data-testid="menu-gamepad"]').title`)).includes('Not available'))
  await snap('m4-menu-panel-layout')
  await setValue('[data-testid="menu-depth"]', '6')
  await commit('[data-testid="menu-depth"]')
  await wait(500)
  check('depth 6 is in menu.json', (await menuJson())['depth'] === 6, String((await menuJson())['depth']))
  await must('[data-testid="menu-pauses"]')
  await wait(400)
  check('Pauses Game is saved', ((await menuJson())['flags'] as { pausesGame?: boolean }).pausesGame === false, JSON.stringify((await menuJson())['flags'])) // the sample starts with true
  await setValue('[data-testid="menu-key"]', '30') // A
  await wait(500)
  check('the key picker writes triggers.hotkey 30', ((await menuJson())['triggers'] as { hotkey?: number }).hotkey === 30, JSON.stringify((await menuJson())['triggers']))
  await setValue('[data-testid="menu-scale"]', '3')
  await commit('[data-testid="menu-scale"]')
  await wait(500)
  check('an invalid UI scale (3) is refused, not saved', ((await menuJson())['userDefaults'] as { uiScale?: number }).uiScale === 1 && (await has('[data-testid="menu-scale"].is-invalid')))
  await snap('m5-invalid-scale')
  await setValue('[data-testid="menu-scale"]', '1.25')
  await commit('[data-testid="menu-scale"]')
  await setValue('[data-testid="menu-offset-x"]', '40')
  await commit('[data-testid="menu-offset-x"]')
  await wait(500)
  check('UI scale 1.25 and offset 40 are saved under userDefaults', JSON.stringify((await menuJson())['userDefaults']) === JSON.stringify({ offsetX: 40, offsetY: 0, uiScale: 1.25 }), JSON.stringify((await menuJson())['userDefaults']))
  await snap('m6-menu-panel-edited')

  key('Escape')
  await wait(300)

  // ---- Deploy: the menu layout, a real write when a scratch MO2 folder is given
  if (process.env['INKWELL_MO2_MODS']) {
    o.session.debug.rebuildAll() // Build All: the deploy ships the last finished build of a custom menu
    let p = await o.session.deployPrepare('mo2Mod', 'all')
    for (let i = 0; i < 40 && p.ok && p.gate.blocking.some((b) => b.code === 'build-not-ready'); i++) {
      await wait(500)
      p = await o.session.deployPrepare('mo2Mod', 'all')
    }
    if (!p.ok) throw new Error(`prepare failed: ${p.error}`)
    console.log('[menu] deploy files:', JSON.stringify(p.files.map((f) => f.rel)), 'gate', JSON.stringify({ ok: p.gate.ok, warnings: p.gate.warnings.map((w) => w.code), blocking: p.gate.blocking.map((w) => w.code) }), 'notes', JSON.stringify(p.notes))
    check('deploy plans the SWF, the menu JSON and the INI (and the runtime check when a Papyrus compiler is set)', p.files.map((f) => f.rel).filter((r) => !r.includes('RuntimeCheck')).sort().join() === ['Interface/Inkwell/InkwellMenuTest/Menu.swf', 'SKSE/Plugins/Inkwell/InkwellMenuTest.ini', 'SKSE/Plugins/Inkwell/menus/InkwellMenuTest_Menu.json'].join())
    const c = await o.session.deployCommit(p.token)
    check('deploy committed', c.ok === true, JSON.stringify(c))
  }
  console.log('[menu] done')
  const { app } = await import('electron')
  app.exit(0)
}
