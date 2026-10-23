import { app, type BrowserWindow } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { createSession } from './session'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Debug only (`INKWELL_SHOTS_DIR=<folder>` and `INKWELL_SHOTS_PROJECT=<scratch project copy>`): drives the real UI through its DOM and the
 * keyboard and saves named PNGs, then exits. States: a-start, b-wire, c-verify, d-debug, e-selected, f-compile-fail, g-popout, h-detached-main.
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
  await wait(1200)
  await snap('a-start') // no project open yet

  if (!o.projectDir) throw new Error('INKWELL_SHOTS_PROJECT is not set')
  const r = await session.open(o.projectDir)
  if (!r.ok) throw new Error(`open failed: ${JSON.stringify(r)}`)
  session.debug.seedBuilds()
  await until('first preview', () => session.getSync().previewMs !== undefined && session.getPreviews().length >= 2, 60000)
  await wait(2500)

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
  if (pw) await snap('g-popout', pw)
  await snap('h-detached-main')

  app.exit(0)
}
