import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { createSession } from './session'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Debug only (`INKWELL_SHOTS_GRAPH=popup` + `INKWELL_SHOTS_DIR` + `INKWELL_SHOTS_PROJECT=<scratch copy of samples/hud-graph-popup>`): runs the popup and the nodes test
 * graph in the real Ruffle preview through the Play panel and checks the movie's values (`inkwellGet`) over time: hidden at start, Show fades in, holds, fades out and
 * hides, Hide, Nodes(false) (Branch, For Each, Do Once, Delay), Nodes(true) (Throw: the node id in the trace, the widget keeps working). States p0 ... p9 plus zoomed
 * widget shots (`z*`). Prints OK/FAILED per check. Never run it on a project you care about.
 */
export async function runPopupShots(o: { outDir: string; projectDir: string; win: () => BrowserWindow | undefined; session: ReturnType<typeof createSession> }): Promise<void> {
  await mkdir(o.outDir, { recursive: true })
  const main = (): BrowserWindow => o.win()!
  const js = <T>(code: string): Promise<T> => main().webContents.executeJavaScript(code) as Promise<T>
  const snap = async (name: string, ms = 400): Promise<void> => {
    await wait(ms)
    await writeFile(join(o.outDir, `${name}.png`), (await main().webContents.capturePage()).toPNG())
    console.log(`[popup] shot ${name}`)
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
  const check = (what: string, ok: boolean, detail = ''): void => console.log(`[popup] ${ok ? 'OK    ' : 'FAILED'} ${what}${detail ? `: ${detail}` : ''}`)
  const get = (path: string): Promise<string> => js<string>(`String(document.querySelector('ruffle-player').inkwellGet(${JSON.stringify(path)}))`)
  const lines = (): Promise<string[]> => js<string[]>(`[...document.querySelectorAll('[data-testid="trace-lines"] li')].map((e) => e.textContent)`)
  const call = async (entry: string, params: Record<string, string | boolean>): Promise<void> => {
    await must('[data-testid="tab-play"]')
    await until('play panel', () => has('[data-testid="play-panel"]'))
    await setValue('[data-testid="play-entry"]', entry)
    await wait(300)
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === 'boolean') {
        const on = await js<boolean>(`document.querySelector('[data-testid="play-param-${k}"]').checked`)
        if (on !== v) await must(`[data-testid="play-param-${k}"]`)
      } else await setValue(`[data-testid="play-param-${k}"]`, v)
    }
    await wait(200)
    await must('[data-testid="play-call"]')
  }
  const card = async (): Promise<string> => `visible=${await get('Popup.card._visible')} alpha=${Math.round(Number(await get('Popup.card._alpha')))}`

  main().setContentSize(1700, 1000)
  main().center()
  const r = await o.session.open(o.projectDir)
  if (!r.ok) throw new Error(`open failed: ${JSON.stringify(r)}`)
  o.session.debug.seedBuilds()
  await wait(1500)
  key('2', ['control']) // Behaviour
  await until('graph canvas', () => has('[data-testid="graph-canvas"]'))
  await until('Ruffle preview built and drawn', async () => (await text('[data-testid="timing"]')).includes('Ruffle'), 60000)
  await wait(1500)
  await snap('p0-start')
  // a taller preview strip and a zoomed widget
  await js(`document.querySelector('.splitter-row').focus()`)
  for (let i = 0; i < 6; i++) key('Down')
  await wait(400)
  const zoom = async (): Promise<void> => {
    await js(`(() => { const z = document.querySelector('.zoom button:last-child'); for (let i = 0; i < 6; i++) z?.click() })()`)
    await wait(400)
    await js(`(() => { const s = document.querySelector('.stage-scroll'); const h = document.querySelector('.ruffle-host').getBoundingClientRect(); const r = s.getBoundingClientRect(); s.scrollLeft += h.right - r.right + 10; s.scrollTop += h.top - r.top - 4 })()`)
  }
  await zoom()
  console.log('[popup] before any call:', await card(), '| report', await get('Popup.report._visible'))
  check('the card starts hidden (On Load)', (await get('Popup.card._visible')) === 'false')
  check('the report starts hidden (On Load)', (await get('Popup.report._visible')) === 'false')
  await snap('z0-hidden')

  // ---- Show(title, description, hold 3)
  await call('main/show', { title: 'Dragon Slayer', description: 'Defeat Alduin at the Throat of the World.', hold: '3' })
  await wait(150)
  const mid = await card()
  await snap('z1-fading-in', 0)
  await wait(500)
  const shown = await card()
  await snap('z2-shown')
  console.log('[popup] during the fade-in:', mid, '| after 0.65 s:', shown)
  check('Show: title text set', (await get('Popup.card.title.text')) === 'Dragon Slayer', await get('Popup.card.title.text'))
  check('Show: description text set', (await get('Popup.card.description.text')).startsWith('Defeat Alduin'))
  check('Show: faded in to 100 and visible', shown === 'visible=true alpha=100', shown)
  await wait(2000) // 0.65 + 2.0 = 2.65 s: still inside the 0.3 + 3 s hold
  check('hold: still visible at full alpha', (await card()) === 'visible=true alpha=100', await card())
  await until('the fade-out to start', async () => Number(await get('Popup.card._alpha')) < 100, 6000) // starts 0.3 + 3 s after the call, lasts 0.3 s
  const fading = await card()
  await snap('z3-fading-out', 0)
  console.log('[popup] during the fade-out:', fading)
  check('fade-out: alpha between 0 and 100 while fading', Number(await get('Popup.card._alpha')) < 100)
  await wait(1000)
  const gone = await card()
  check('fade out ended hidden', gone.startsWith('visible=false'), gone)
  await snap('z4-hidden-again')

  // ---- hold 0 stays until Hide()
  await call('main/show', { title: 'Sticky', description: 'stays until Hide', hold: '0' })
  await wait(2500)
  check('hold 0: still visible after 2.5 s', (await card()) === 'visible=true alpha=100', await card())
  await call('main/hide', {})
  await wait(900)
  check('Hide: faded out and hidden', (await card()).startsWith('visible=false'), await card())

  // ---- nodes test
  await call('nodes/call', { fail: false })
  await wait(600)
  const n1 = await get('Popup.report.status.text')
  await snap('z5-nodes-first')
  console.log('[popup] Nodes(false) after 0.6 s:', JSON.stringify(n1))
  check('Nodes(false): Format and For Each (3 items) ran, the Set Text came before Do Once and Delay', n1 === 'start, fail=false [item 0] [item 1] [item 2]', n1)
  const pa = Math.round(Number(await get('Popup.report.report_panel._alpha')))
  check('data binding: the report panel alpha follows variable panelAlpha (60)', pa === 60, String(pa))
  await wait(1300)
  const n2 = await get('Popup.report.status.text')
  await snap('z6-nodes-delay')
  check('Do Once (" once") and Delay (" delay") appended after 1 s', n2 === 'start, fail=false [item 0] [item 1] [item 2] once delay', n2)
  await call('nodes/call', { fail: false })
  await wait(600)
  const n3 = await get('Popup.report.status.text')
  check('second run: Do Once does not run again', n3 === 'start, fail=false [item 0] [item 1] [item 2]', n3)
  await wait(1300)

  // ---- the deliberate error
  await call('nodes/call', { fail: true })
  await wait(700)
  const n4 = await get('Popup.report.status.text')
  await snap('z7-nodes-error')
  check('Nodes(true): stops at the Throw (text still "start, fail=true")', n4 === 'start, fail=true', n4)
  await must('[data-testid="tab-trace"]')
  await wait(500)
  const tl = await lines()
  console.log('[popup] trace lines:', JSON.stringify(tl))
  check('Throw: the failing node id and message are traced as an error', tl.some((l) => l.includes('ERROR') && l.includes('#throw') && l.includes('deliberate error')))
  await snap('p8-trace')
  await call('nodes/call', { fail: false })
  await wait(700)
  check('after the error the widget still works', (await get('Popup.report.status.text')).startsWith('start, fail=false [item 0]'), await get('Popup.report.status.text'))
  await call('main/show', { title: 'Still alive', description: 'after the error', hold: '2' })
  await wait(700)
  check('after the error the popup still works', (await get('Popup.card.title.text')) === 'Still alive' && (await card()) === 'visible=true alpha=100', await card())
  await snap('z8-after-error')
  console.log('[popup] done')
  const { app } = await import('electron')
  app.exit(0)
}
