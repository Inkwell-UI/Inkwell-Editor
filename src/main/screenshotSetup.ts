import { app, type BrowserWindow } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import type { createSession } from './session'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Debug only (`INKWELL_SHOTS_SETUP=1` with `INKWELL_SHOTS_DIR` and `INKWELL_SHOTS_PROJECT=<scratch project copy>`): the Settings view with this machine's real
 * results (plus the on-request benchmark), the Deploy dropdown, the first-deploy confirmation, and the real deploy with its toast and status bar item.
 * It really deploys to the target the settings name (INKWELL_MO2_MODS + the project name), so point those at a folder you may overwrite.
 * States: n-doctor, o-doctor-bottom, p-doctor-benchmark, p2-doctor-cache, q-deploy-menu, r-deploy-confirm, s-deploy-done (or r-deploy-blocked
 * and exit when the export gate blocks: give it a project with a lint error).
 */
export async function runSetupShots(o: { outDir: string; projectDir: string; win: () => BrowserWindow | undefined; session: ReturnType<typeof createSession> }): Promise<void> {
  await mkdir(o.outDir, { recursive: true })
  const main = (): BrowserWindow => o.win()!
  const js = <T>(code: string): Promise<T> => main().webContents.executeJavaScript(code) as Promise<T>
  const snap = async (name: string): Promise<void> => {
    await wait(600)
    await writeFile(join(o.outDir, `${name}.png`), (await main().webContents.capturePage()).toPNG())
    console.log(`[shots] ${name}`)
  }
  const click = (sel: string): Promise<boolean> => js<boolean>(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true })()`)
  const until = async (what: string, fn: () => boolean | Promise<boolean>, ms = 60000): Promise<void> => {
    const t0 = Date.now()
    while (!(await fn())) {
      if (Date.now() - t0 > ms) throw new Error(`Timed out waiting for ${what}`)
      await wait(150)
    }
  }
  const has = (sel: string): Promise<boolean> => js<boolean>(`!!document.querySelector(${JSON.stringify(sel)})`)
  const must = async (sel: string): Promise<void> => {
    if (!(await click(sel))) throw new Error(`Not found: ${sel}`)
  }

  main().setContentSize(1440, 960)
  main().center()
  const r = await o.session.open(o.projectDir)
  if (!r.ok) throw new Error(`open failed: ${JSON.stringify(r)}`)
  await until('ffdec state', () => !!o.session.getSync().ffdec)
  await wait(1500)

  main().webContents.send(IPC.menuSettings) // what Edit > Settings does
  await until('settings view', () => has('[data-testid="settings-view"]'))
  await until('doctor rows', () => js<boolean>(`document.querySelectorAll('.doctor-row').length === 9 && !document.querySelector('[data-testid="doctor-rerun"][aria-disabled="true"]')`))
  await snap('n-doctor')
  await js(`document.querySelector('.settings-body').scrollTop = 99999`)
  await snap('o-doctor-bottom')
  await js(`document.querySelector('.settings-body').scrollTop = 0`)
  if (await has('[data-testid="doctor-fix-wrapper"]')) {
    await must('[data-testid="doctor-fix-wrapper"]')
    await until('benchmark', () => has('[data-testid="doctor-benchmark"]'), 120000)
    await js(`document.querySelector('[data-testid="doctor-benchmark"]').scrollIntoView({ block: 'center' })`)
    await snap('p-doctor-benchmark')
    console.log('[shots] benchmark:', await js<string>(`document.querySelector('[data-testid="doctor-benchmark"]').innerText.replace(/\\n/g, ' | ')`))
  }
  if (await has('[data-testid="doctor-fix-vanilla"]')) {
    await must('[data-testid="doctor-fix-vanilla"]') // builds the real cache into <userData>/vanilla-cache (the scratch user-data dir)
    await until('vanilla cache', () => has('[data-testid="doctor-vanilla"][data-status="pass"]'), 120000)
    await js(`document.querySelector('[data-testid="doctor-vanilla"]').scrollIntoView({ block: 'center' })`)
    await snap('p2-doctor-cache')
    console.log('[shots] vanilla:', await js<string>(`document.querySelector('[data-testid="doctor-vanilla"]').innerText.split(String.fromCharCode(10)).join(' | ')`))
  }
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await wait(300)

  await must('[data-testid="deploy"]')
  await until('deploy menu', () => has('[data-testid="deploy-mo2Mod"]'))
  await wait(300)
  await snap('q-deploy-menu')
  await must('[data-testid="deploy-mo2Mod"]')
  await until('confirmation', () => has('[data-testid="deploy-confirm"]'), 120000)
  if (await has('[data-testid="deploy-blocked"]')) { // a project with lint errors: the export gate dialog, Deploy disabled; nothing is written
    await snap('r-deploy-blocked')
    console.log('[shots] blocked:', await js<string>(`document.querySelector('[data-testid="deploy-confirm"]').innerText.replace(/\\n/g, ' | ')`))
    console.log('[shots] status:', await js<string>(`document.querySelector('[data-testid="deploy-status"]')?.innerText ?? '(none)'`))
    app.exit(0)
    return
  }
  await snap('r-deploy-confirm')
  await must('[data-testid="deploy-confirm-ok"]')
  await until('toast', () => has('[data-testid="toast"]'), 60000)
  await snap('s-deploy-done')
  console.log('[shots] toast:', await js<string>(`document.querySelector('[data-testid="toast"]').innerText.replace(/\\n/g, ' | ')`))
  console.log('[shots] status:', await js<string>(`document.querySelector('[data-testid="deploy-status"]')?.innerText ?? '(none)'`))
  app.exit(0)
}
