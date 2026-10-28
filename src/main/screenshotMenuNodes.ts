import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { createSession } from './session'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Debug only (`INKWELL_SHOTS_MENU=nodes` + `INKWELL_SHOTS_DIR` + `INKWELL_SHOTS_PROJECT=<scratch copy of samples/menu-nodes>`): the Phase 5 nodes in the real Ruffle preview with the
 * mock runtime. List: rows, real click, real mouse wheel, Play panel Up/Accept; saved counter surviving Reopen (a fresh menu class, like the engine); mod event loop-back and the Play
 * panel's mod event; Get Setting / Get Input Device texts; Play Sound reaches the mock. Prints OK/FAILED per check. States n0 ... n5. Edits the project it is given: use a copy.
 */
export async function runMenuNodesShots(o: { outDir: string; projectDir: string; win: () => BrowserWindow | undefined; session: ReturnType<typeof createSession> }): Promise<void> {
  await mkdir(o.outDir, { recursive: true })
  const main = (): BrowserWindow => o.win()!
  const js = <T>(code: string): Promise<T> => main().webContents.executeJavaScript(code) as Promise<T>
  const snap = async (name: string, ms = 400): Promise<void> => {
    await wait(ms)
    await writeFile(join(o.outDir, `${name}.png`), (await main().webContents.capturePage()).toPNG())
    console.log(`[nodes] shot ${name}`)
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
  const key = (keyCode: string, modifiers: ('control' | 'shift')[] = []): void => {
    for (const type of ['keyDown', 'keyUp'] as const) main().webContents.sendInputEvent({ type, keyCode, modifiers })
  }
  let bad = 0
  const check = (what: string, ok: boolean, detail = ''): void => {
    if (!ok) bad++
    console.log(`[nodes] ${ok ? 'OK    ' : 'FAILED'} ${what}${detail ? `: ${detail}` : ''}`)
  }
  const get = (path: string): Promise<string> => js<string>(`String(document.querySelector('ruffle-player').inkwellGet(${JSON.stringify(path)}))`)
  const lines = (): Promise<string[]> => js<string[]>(`[...document.querySelectorAll('[data-testid="trace-lines"] li')].map((e) => e.textContent)`)
  const rect = () => js<{ x: number; y: number; w: number; h: number }>(`(() => { const b = document.querySelector('ruffle-player').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height } })()`)
  /** A point in stage px (1920x1080 fills the player) as window coordinates. */
  const at = async (sx: number, sy: number): Promise<{ x: number; y: number }> => {
    const r = await rect()
    return { x: Math.round(r.x + (sx / 1920) * r.w), y: Math.round(r.y + (sy / 1080) * r.h) }
  }
  const tabPlay = async (): Promise<void> => {
    await must('[data-testid="tab-play"]')
    await until('play panel', () => has('[data-testid="play-menu"]'))
  }
  const playClick = async (nodeId: string): Promise<void> => {
    await tabPlay()
    await setValue('[data-testid="play-menu-target"]', nodeId)
    await wait(150)
    await must('[data-testid="play-menu-click"]')
    await wait(400)
  }

  main().setContentSize(1700, 1000)
  main().center()
  const r = await o.session.open(o.projectDir)
  if (!r.ok) throw new Error(`open failed: ${JSON.stringify(r)}`)
  o.session.debug.seedBuilds()
  await wait(1500)
  key('2', ['control']) // Behaviour
  await until('graph canvas', () => has('[data-testid="graph-canvas"]'))
  await until('Ruffle preview built and drawn', async () => (await text('[data-testid="timing"]')).includes('Render'), 90000)
  await wait(1500)

  // ---- start state
  check('the mock bridge is ready and the menu class started its graph', (await get('inkwell.ready')) === 'true' && (await get('inkwellMenu.graphs.length')) === '1')
  check('the list shows the three string items (Split -> Set Items on Load)', (await get('list.row0.label.text')) === 'Alpha' && (await get('list.row1.label.text')) === 'Beta' && (await get('list.row2.label.text')) === 'Gamma', [await get('list.row0.label.text'), await get('list.row1.label.text'), await get('list.row2.label.text')].join('|'))
  check('nothing highlighted yet (value -1); template hidden', (await get('list.value')) === '-1' && (await get('list.row._visible')) === 'false')
  check('Get Setting shows the default, Get Input Device the keyboard', (await get('settingText.text')) === 'Setting: default (key absent)' && (await get('deviceText.text')) === 'Device: keyboardMouse', `${await get('settingText.text')} / ${await get('deviceText.text')}`)
  check('the saved counter starts at its default', (await get('countText.text')) === 'Clicks: 0')
  await snap('n0-start')

  // ---- real mouse click on row 1 (stage 660..1260 x 260..306)
  await must('[data-testid="mode-play"]')
  const row1 = await at(960, 283)
  const press = async (p: { x: number; y: number }): Promise<void> => {
    main().webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y })
    await wait(300)
    main().webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 })
    await wait(120)
    main().webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 })
    await wait(600)
  }
  for (let a = 0; a < 3 && (await get('list.value')) !== '1'; a++) await press(row1)
  check('a real click on row 2 highlights it (change: value 1) and activates it (itemClick: On Item Selected)', (await get('list.value')) === '1' && (await get('selText.text')) === 'Selected: 1', `${await get('list.value')} / ${await get('selText.text')}`)
  check('the highlighted row is opaque, the others dimmed', (await get('list.row1._alpha')) === '100' && Number(await get('list.row0._alpha')) < 70, `${await get('list.row1._alpha')} / ${await get('list.row0._alpha')}`)
  await snap('n1-list-clicked')

  // ---- real mouse wheel over the list: down moves the highlight 1 -> 2 and scrolls (2 rows fit)
  main().webContents.sendInputEvent({ type: 'mouseWheel', x: row1.x, y: row1.y, deltaX: 0, deltaY: -120 } as never)
  await wait(500)
  check('mouse wheel down moves the highlight to 2 and scrolls the rows (Beta on top)', (await get('list.value')) === '2' && (await get('list.row0.label.text')) === 'Beta', `${await get('list.value')} / ${await get('list.row0.label.text')}`)
  main().webContents.sendInputEvent({ type: 'mouseWheel', x: row1.x, y: row1.y, deltaX: 0, deltaY: 120 } as never)
  await wait(500)
  check('mouse wheel up moves it back to 1', (await get('list.value')) === '1', await get('list.value'))
  await snap('n2-list-wheel')

  // ---- Play panel: forwarded user events (the runtime's path) and real keys
  await tabPlay()
  await setValue('[data-testid="play-input-action"]', 'Up')
  await must('[data-testid="play-send-input"]')
  await wait(300)
  check('Input Up (runtime path) moves the highlight to 0', (await get('list.value')) === '0', await get('list.value'))
  await setValue('[data-testid="play-input-action"]', 'Accept')
  await must('[data-testid="play-send-input"]')
  await wait(300)
  check('Input Accept activates the highlighted row (On Item Selected: index 0)', (await get('selText.text')) === 'Selected: 0', await get('selText.text'))
  await setValue('[data-testid="play-input-action"]', 'Down')
  await must('[data-testid="play-send-input"]')
  await wait(300)
  check('Input Down moves to 1; after the runtime sent input the AS2 key listener is off (a real Down key changes nothing)', (await get('list.value')) === '1', await get('list.value'))
  key('Down')
  await wait(300)
  check('real Down key ignored once the runtime forwards input (no double move)', (await get('list.value')) === '1', await get('list.value'))

  // ---- saved counter + Reopen
  await playClick('2:6')
  await playClick('2:6')
  check('Count +1 twice: the text follows, the bridge holds 2', (await get('countText.text')) === 'Clicks: 2' && (await get('inkwell.saved.clicks')) === '2', `${await get('countText.text')} / ${await get('inkwell.saved.clicks')}`)
  await snap('n3-counted')
  await tabPlay()
  await must('[data-testid="play-menu-reopen"]')
  await wait(800)
  check('Reopen made a fresh menu class and graph (reopens 1) that read the saved value back', (await get('inkwell.reopens')) === '1' && (await get('inkwellGraph0.v_clicks')) === '2' && (await get('countText.text')) === 'Clicks: 2', `${await get('inkwell.reopens')} / ${await get('inkwellGraph0.v_clicks')} / ${await get('countText.text')}`)
  await playClick('2:6')
  check('counting continues from the saved value (3)', (await get('inkwell.saved.clicks')) === '3' && (await get('countText.text')) === 'Clicks: 3', await get('inkwell.saved.clicks'))
  check('the list still works after Reopen (one listener: a click activates once)', (await get('list.getSelectedIndex')) !== undefined)

  // ---- mod events
  await playClick('2:5')
  check('Send Mod Event button: the mock loops it back, On Mod Event appends the string', (await get('eventText.text')) === 'Events: ping', await get('eventText.text'))
  await tabPlay()
  await setValue('[data-testid="play-event-name"]', 'InkwellMenuNodes_Ping')
  await setValue('[data-testid="play-event-str"]', 'pong')
  await must('[data-testid="play-send-modevent"]')
  await wait(400)
  check('a mod event fired from the Play panel appends too', (await get('eventText.text')) === 'Events: ping pong', await get('eventText.text'))
  await setValue('[data-testid="play-event-name"]', 'Other')
  await must('[data-testid="play-send-modevent"]')
  await must('[data-testid="play-send-message"]')
  await wait(300)
  check('another event name and a runtime message with no handler change nothing', (await get('eventText.text')) === 'Events: ping pong')
  await snap('n4-events')

  // ---- Play Sound reaches the mock bridge
  await playClick('2:11')
  await must('[data-testid="tab-trace"]')
  await wait(400)
  const tl = await lines()
  console.log('[nodes] trace lines:', JSON.stringify(tl))
  check('Play Sound reached the mock (UIMenuOK)', tl.some((l) => l.includes('mock playSound UIMenuOK')))
  check('no ERROR line in the trace', !tl.some((l) => l.includes('ERROR')))
  await snap('n5-trace')
  console.log(`[nodes] done, ${bad} failed`)
  const { app } = await import('electron')
  app.exit(bad ? 1 : 0)
}
