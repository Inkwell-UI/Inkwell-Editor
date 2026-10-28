import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { createSession } from './session'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Debug only (`INKWELL_SHOTS_GLYPHS=1` + `INKWELL_SHOTS_DIR` + `INKWELL_SHOTS_PROJECT=<scratch copy of samples/menu-gamepad>`): the prompt glyphs in the real Ruffle preview, one screenshot
 * per device of the Prompts preview choice (g-keyboard, g-xbox, g-playstation). Edits the project it is given: use a copy. Returns the number of failed checks.
 */
export async function runGlyphShots(o: { outDir: string; projectDir: string; win: () => BrowserWindow | undefined; session: ReturnType<typeof createSession> }): Promise<number> {
  await mkdir(o.outDir, { recursive: true })
  const main = (): BrowserWindow => o.win()!
  const js = <T>(code: string): Promise<T> => main().webContents.executeJavaScript(code) as Promise<T>
  const text = (sel: string): Promise<string> => js<string>(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`)
  const until = async (what: string, fn: () => boolean | Promise<boolean>, ms = 60000): Promise<void> => {
    const t0 = Date.now()
    while (!(await fn())) {
      if (Date.now() - t0 > ms) throw new Error(`Timed out waiting for ${what}`)
      await wait(100)
    }
  }
  main().setContentSize(1700, 1000)
  main().center()
  const r = await o.session.open(o.projectDir)
  if (!r.ok) throw new Error(`open failed: ${JSON.stringify(r)}`)
  o.session.debug.seedBuilds()
  await wait(1500)
  await until('Ruffle preview built and drawn', async () => (await text('[data-testid="timing"]')).includes('Ruffle'), 90000)
  await wait(1500)
  for (const d of ['keyboard', 'xbox', 'playstation']) {
    const ok = await js<boolean>(`(() => { const e = document.querySelector('[data-testid="stage-prompts"]'); if (!e) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(e, ${JSON.stringify(d)}); e.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
    if (!ok) throw new Error('The Prompts select is not on screen')
    await wait(1200)
    await writeFile(join(o.outDir, `g-${d}.png`), (await main().webContents.capturePage()).toPNG())
    console.log(`[glyphs] shot g-${d}`)
  }
  return 0
}
