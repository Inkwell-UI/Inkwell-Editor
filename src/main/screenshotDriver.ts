import { app, type BrowserWindow } from 'electron'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { createSession } from './session'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Debug only (`INKWELL_SHOTS_DIR=<folder>` and `INKWELL_SHOTS_PROJECT=<scratch project copy>`): drives the real UI through its DOM and the
 * keyboard and saves named PNGs, then exits. States: a-start, b-wire, c-verify, d-debug, e-selected, i-stage-hover, j-stage-select, k-overlay-edit
 * (also checks overlay.json on disk after an edit and an undo), f-compile-fail, g-popout, h-detached-main.
 * The failing build is injected into the sync server's onChange (the real status path); nothing in the project folder is damaged.
 * Never run it against a project you care about: it builds into the project's build/ folder.
 */
export async function runShots(o: {
  outDir: string
  projectDir: string | undefined
  win: () => BrowserWindow | undefined
  previewWin: () => BrowserWindow | undefined
  session: ReturnType<typeof createSession>
}): Promise<void> {
  const { session } = o
  await mkdir(o.outDir, { recursive: true })
  const main = (): BrowserWindow => o.win()!
  const js = <T>(code: string, w: BrowserWindow = main()): Promise<T> => w.webContents.executeJavaScript(code) as Promise<T>
  const snap = async (name: string, w: BrowserWindow = main()): Promise<void> => {
    await wait(700)
    await writeFile(join(o.outDir, `${name}.png`), (await w.webContents.capturePage()).toPNG())
    console.log(`[shots] ${name}`)
  }
  const key = (keyCode: string, modifiers: ('control' | 'shift')[] = []): void => {
    for (const type of ['keyDown', 'keyUp'] as const) main().webContents.sendInputEvent({ type, keyCode, modifiers })
  }
  const click = (sel: string, w: BrowserWindow = main()): Promise<boolean> =>
    js<boolean>(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true })()`, w)
  const until = async (what: string, fn: () => boolean | Promise<boolean>, ms = 30000): Promise<void> => {
    const t0 = Date.now()
    while (!(await fn())) {
      if (Date.now() - t0 > ms) throw new Error(`Timed out waiting for ${what}`)
      await wait(150)
    }
  }

  await until('window', () => !!o.win() && !o.win()!.webContents.isLoading())
  console.log('[shots] window before', JSON.stringify(main().getBounds()), JSON.stringify(main().getContentSize()))
  main().setContentSize(1440, 860)
  main().center()
  await wait(500)
  console.log('[shots] window after', JSON.stringify(main().getBounds()), JSON.stringify(main().getContentSize()))
  await wait(1200)
  await snap('a-start') // no project open yet

  if (!o.projectDir) throw new Error('INKWELL_SHOTS_PROJECT is not set')
  if (process.env['INKWELL_SHOTS_SNAPSHOT']) return snapshotShots(o.projectDir)
  const r = await session.open(o.projectDir)
  if (!r.ok) throw new Error(`open failed: ${JSON.stringify(r)}`)
  session.debug.seedBuilds()
  if (process.env['INKWELL_SHOTS_NOFFDEC']) {
    // run with INKWELL_FFDEC pointing nowhere: Build All disabled, status bar `FFDec: not found`, builds report the error
    await wait(4000)
    await snap('m-no-ffdec')
    app.exit(0)
    return
  }
  await until('builds of both swfs', () => session.getPreviews().length >= 2, 90000)
  await wait(5000) // Ruffle loads and draws the shown swf

  key('1', ['control'])
  await snap('b-wire')
  key('2', ['control'])
  await snap('c-verify')
  key('3', ['control'])
  await snap('d-debug')

  key('1', ['control'])
  await wait(300)
  const layer = process.env['INKWELL_SHOTS_NODE'] ?? '1:3'
  if (!(await click(`[data-layer-id="${layer}"]`))) throw new Error(`Navigator row ${layer} not found`)
  await wait(500)
  await snap('e-selected')

  // Inspect mode on the stage: hover one layer, click another (synthetic pointer events on the real overlay, hit-tested against the IR)
  key('2', ['control'])
  await wait(600)
  if (!(await click('[data-layer-id="1:4"]'))) throw new Error('Navigator row 1:4 not found')
  const at = (type: string, sx: number, sy: number): Promise<boolean> =>
    js<boolean>(`(() => { const o = document.querySelector('[data-testid="inspect-overlay"]'); if (!o) return false; const r = o.getBoundingClientRect(); const s = Math.min(r.width / 1920, r.height / 1080); const x = r.left + (r.width - 1920 * s) / 2 + ${sx} * s; const y = r.top + (r.height - 1080 * s) / 2 + ${sy} * s; o.dispatchEvent(new PointerEvent(${JSON.stringify(type)}, { bubbles: true, clientX: x, clientY: y })); return true })()`)
  await at('pointermove', 100, 80)
  await snap('i-stage-hover')
  await at('pointerdown', 100, 80)
  await wait(400)
  console.log('[shots] selected after stage click:', await js<string>(`document.querySelector('.layer-row.is-selected .layer-name')?.textContent ?? '(none)'`))
  await snap('j-stage-select')

  // overlay edit: type an instance name, blur to commit, check the file, undo, check again
  key('1', ['control'])
  await wait(500)
  await js(`(() => { const i = document.querySelector('[data-testid="instance-name"]'); i.focus(); i.select() })()`)
  main().webContents.insertText('Hello_Txt')
  await js(`document.activeElement.blur()`)
  await wait(800)
  const file = join(o.projectDir, 'swfs', 'hud', 'overlay.json')
  const entry = async (): Promise<unknown> => (JSON.parse(await readFile(file, 'utf8')) as { nodes?: Record<string, unknown> }).nodes?.['1:3']
  console.log('[shots] overlay after edit:', JSON.stringify(await entry()))
  await snap('k-overlay-edit')
  key('Z', ['control'])
  await wait(800)
  console.log('[shots] overlay after undo:', JSON.stringify(await entry()))

  session.debug.failBuilds(true)
  session.debug.rebuildAll()
  await until('error state', () => session.getSync().build === 'error')
  await snap('f-compile-fail')
  session.debug.failBuilds(false)
  session.debug.rebuildAll()
  await until('recovered', () => session.getSync().build !== 'error')

  if (!(await click('[data-testid="stage-popout"]'))) throw new Error('Pop-out button not found')
  await until('popout window', () => !!o.previewWin() && !o.previewWin()!.webContents.isLoading())
  await wait(3000)
  const pw = o.previewWin()
  pw?.setContentSize(1100, 640)
  main().setContentSize(1440, 860)
  await wait(600)
  if (pw) await snap('g-popout', pw)
  await snap('h-detached-main')

  app.exit(0)

  /**
   * INKWELL_SHOTS_SNAPSHOT=1: the Figma snapshot states with no plugin connected. Deletes the scratch project's figma/snapshot.json first (no-snapshot
   * state), builds (which writes it), then edits one ir.json and reopens (stale). l1-no-snapshot, l2-figma-no-snapshot, l3-snapshot, l4-figma-snapshot, l5-figma-stale.
   */
  async function snapshotShots(dir: string): Promise<void> {
    const snapFile = join(dir, 'figma', 'snapshot.json')
    await rm(snapFile, { force: true })
    const popover = async (name: string): Promise<void> => {
      await click('[data-testid="dot-figma"]')
      await until('figma popover', () => js<boolean>(`!!document.querySelector('[data-testid="snapshot-facts"]')`))
      await snap(name)
      console.log(`[shots] ${name}:`, await js<string>(`document.querySelector('[data-testid="dot-figma"]').getAttribute('aria-label') + ' | ' + document.querySelector('[data-testid="snapshot-facts"]').innerText.replace(/\\n/g, ' | ')`))
      await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
      await wait(300)
      if (await js<boolean>(`!!document.querySelector('[data-testid="snapshot-facts"]')`)) await click('[data-testid="dot-figma"]') // Escape did not close it
      await wait(300)
    }
    const banner = (): Promise<string> => js<string>(`(() => { const b = document.querySelector('[data-testid="snapshot-banner"]'); return b ? b.dataset.snapshot + ': ' + b.innerText : '(no banner)' })()`)
    const r = await session.open(dir)
    if (!r.ok) throw new Error(`open failed: ${JSON.stringify(r)}`)
    await wait(2500)
    await snap('l1-no-snapshot')
    console.log('[shots] banner:', await banner())
    await popover('l2-figma-no-snapshot')
    session.debug.seedBuilds() // offline builds from ir.json; the pipeline writes figma/snapshot.json
    await until('snapshot written', () => readFile(snapFile).then(() => true, () => false), 90000)
    await until('builds', () => session.getPreviews().length >= 1, 90000)
    await wait(4000)
    await snap('l3-snapshot')
    console.log('[shots] banner:', await banner())
    await popover('l4-figma-snapshot')
    const irFile = join(dir, 'swfs', 'hud', 'ir.json')
    const ir = JSON.parse(await readFile(irFile, 'utf8')) as { nodes: Record<string, { name: string }> }
    const first = Object.values(ir.nodes)[1]!
    first.name = `${first.name} (edited by hand)`
    await writeFile(irFile, JSON.stringify(ir, null, 2))
    const r2 = await session.open(dir)
    if (!r2.ok) throw new Error(`reopen failed: ${JSON.stringify(r2)}`)
    await wait(2500)
    await popover('l5-figma-stale')
    app.exit(0)
  }
}
