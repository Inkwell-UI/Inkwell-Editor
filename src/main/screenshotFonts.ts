import type { BrowserWindow } from 'electron'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Debug only (`INKWELL_SHOTS_FONTS=1` + `INKWELL_SHOTS_DIR` + `INKWELL_FONTS_SANDBOX=<scratch dir>`, separate `--user-data-dir`): the Settings
 * section "Fonts for Figma" before, the confirm dialog, after Install, after Remove. Refuses without the sandbox, so it never installs for real.
 * Shots: f1-fonts, f2-fonts-confirm, f3-fonts-installed (or f3-fonts-error), f5-fonts-partial (the newest 6 faces dropped from the sandbox: installed vs
 * missing), f6-fonts-confirm-missing, f7-fonts-completed (Install missing fonts), f4-fonts-removed.
 */
export async function runFontShots(o: { outDir: string; win: () => BrowserWindow | undefined }): Promise<void> {
  if (!process.env['INKWELL_FONTS_SANDBOX']) throw new Error('INKWELL_SHOTS_FONTS needs INKWELL_FONTS_SANDBOX (it clicks Install)')
  await mkdir(o.outDir, { recursive: true })
  const main = (): BrowserWindow => o.win()!
  const js = <T>(code: string): Promise<T> => main().webContents.executeJavaScript(code) as Promise<T>
  const has = (sel: string): Promise<boolean> => js<boolean>(`!!document.querySelector(${JSON.stringify(sel)})`)
  const click = async (sel: string): Promise<void> => {
    if (!(await js<boolean>(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true })()`))) throw new Error(`Not found: ${sel}`)
  }
  const until = async (what: string, fn: () => Promise<boolean>, ms = 180000): Promise<void> => {
    const t0 = Date.now()
    while (!(await fn())) {
      if (Date.now() - t0 > ms) throw new Error(`Timed out waiting for ${what}`)
      await wait(150)
    }
  }
  const snap = async (name: string): Promise<void> => {
    await wait(600)
    await js(`document.querySelector('[data-testid="fonts-figma"]')?.scrollIntoView({ block: 'start' })`)
    await wait(200)
    await writeFile(join(o.outDir, `${name}.png`), (await main().webContents.capturePage()).toPNG())
    console.log(`[shots] ${name}:`, await js<string>(`document.querySelector('[data-testid="fonts-figma"]').innerText.replace(/\\n/g, ' | ')`))
  }
  main().setContentSize(1440, 960)
  await until('window', async () => !!o.win() && !main().webContents.isLoading())
  await wait(1500)
  main().webContents.send(IPC.menuSettings)
  await until('fonts section', () => has('[data-testid="fonts-status"] strong'))
  await snap('f1-fonts')
  await click('[data-testid="fonts-install"]')
  await until('confirm', () => has('[data-testid="fonts-confirm"]'))
  await wait(600)
  await writeFile(join(o.outDir, 'f2-fonts-confirm.png'), (await main().webContents.capturePage()).toPNG())
  console.log('[shots] f2-fonts-confirm')
  await click('[data-testid="fonts-confirm-ok"]')
  await until('install result', () => has('[data-testid="fonts-done"], [data-testid="fonts-error"]'))
  if (await has('[data-testid="fonts-error"]')) return snap('f3-fonts-error')
  await snap('f3-fonts-installed')
  // an older install: drop the newest 6 faces (files, registry values, manifest rows) inside the sandbox, so Settings shows installed vs missing
  const sandbox = process.env['INKWELL_FONTS_SANDBOX']!
  const manifest = JSON.parse(await readFile(join(sandbox, 'manifest.json'), 'utf8')) as { fonts: { file: string; regName: string }[] }
  const registry = JSON.parse(await readFile(join(sandbox, 'registry.json'), 'utf8')) as Record<string, string>
  for (const f of manifest.fonts.slice(-6)) {
    await rm(f.file, { force: true })
    delete registry[f.regName]
  }
  manifest.fonts = manifest.fonts.slice(0, -6)
  await writeFile(join(sandbox, 'manifest.json'), JSON.stringify(manifest))
  await writeFile(join(sandbox, 'registry.json'), JSON.stringify(registry))
  main().webContents.reload()
  await until('reload', async () => !main().webContents.isLoading())
  await wait(1500)
  main().webContents.send(IPC.menuSettings)
  await until('fonts section', () => has('[data-testid="fonts-missing"]'))
  await snap('f5-fonts-partial')
  await click('[data-testid="fonts-install"]')
  await until('confirm', () => has('[data-testid="fonts-confirm"]'))
  await wait(600)
  await writeFile(join(o.outDir, 'f6-fonts-confirm-missing.png'), (await main().webContents.capturePage()).toPNG())
  await click('[data-testid="fonts-confirm-ok"]')
  await until('install missing result', () => has('[data-testid="fonts-done"], [data-testid="fonts-error"]'))
  await snap('f7-fonts-completed')
  await click('[data-testid="fonts-remove"]')
  await until('remove result', () => js<boolean>(`!document.querySelector('[data-testid="fonts-progress"]') && document.querySelector('[data-testid="fonts-done"]')?.textContent.includes('removed')`))
  await snap('f4-fonts-removed')
}
