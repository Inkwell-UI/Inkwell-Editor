import type { BrowserWindow } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { createSession } from './session'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Debug only (`INKWELL_SHOTS_ASSETS=1` + `INKWELL_SHOTS_DIR` + `INKWELL_SHOTS_PROJECT=<scratch copy of a project with images, e.g. build/image-test-project>`, separate `--user-data-dir`):
 * opens Assets mode, takes the list, presses 9-slice (checks slices.json on disk), a 3-slice horizontal, then Clear (the entry is gone). Shots: s1-assets, s2-nine, s3-horizontal, s4-cleared.
 * Never run it against a project you care about: it writes slices.json and builds into the project's build/ folder. Exits 1 when a check fails.
 */
export async function runAssetShots(o: { outDir: string; projectDir: string; win: () => BrowserWindow | undefined; session: ReturnType<typeof createSession> }): Promise<boolean> {
  await mkdir(o.outDir, { recursive: true })
  const main = (): BrowserWindow => o.win()!
  const js = <T>(code: string): Promise<T> => main().webContents.executeJavaScript(code) as Promise<T>
  const snap = async (name: string): Promise<void> => {
    await wait(700)
    await writeFile(join(o.outDir, `${name}.png`), (await main().webContents.capturePage()).toPNG())
    console.log(`[shots] ${name}`)
  }
  const until = async (what: string, fn: () => Promise<boolean>, ms = 30000): Promise<void> => {
    const t0 = Date.now()
    while (!(await fn())) {
      if (Date.now() - t0 > ms) throw new Error(`Timed out waiting for ${what}`)
      await wait(150)
    }
  }
  const clickText = (text: string): Promise<boolean> =>
    js<boolean>(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent.trim() || x.getAttribute('aria-label')) === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true })()`)
  const slicesOnDisk = async (): Promise<Record<string, Record<string, number>>> => {
    try {
      return (JSON.parse(await readFile(join(o.projectDir, 'slices.json'), 'utf8')) as { assets: Record<string, Record<string, number>> }).assets
    } catch {
      return {}
    }
  }
  let bad = false
  const check = (name: string, ok: boolean, detail = ''): void => {
    console.log(`[shots] ${ok ? 'ok  ' : 'FAIL'} ${name} ${detail}`)
    if (!ok) bad = true
  }

  await until('window', async () => !!o.win() && !main().webContents.isLoading())
  main().setContentSize(1440, 860)
  main().center()
  const r = await o.session.open(o.projectDir)
  if (!r.ok) throw new Error(`open failed: ${JSON.stringify(r)}`)
  await wait(1500)
  await until('mode switcher', () => js<boolean>('!!document.querySelector(\'[data-workspace="assets"]\')')).catch(async (e: unknown) => {
    await snap('s0-no-switcher') // what the window shows instead (start screen, setup guide, an error)
    throw e
  })
  await js('document.querySelector(\'[data-workspace="assets"]\').click()')
  await until('image list', () => js<boolean>('!!document.querySelector(".asv-thumb")'))
  await snap('s1-assets')
  check('thumbnails', (await js<number>('document.querySelectorAll(".asv-thumb").length')) > 0)

  check('9-slice preset clicked', await clickText('9-slice'))
  await wait(800)
  const nine = Object.values(await slicesOnDisk())[0]
  check('slices.json has the 9-slice', !!nine && nine['l'] === nine['r'] && nine['l']! > 0 && nine['t']! > 0, JSON.stringify(nine))
  await snap('s2-nine')

  check('3-slice preset clicked', await clickText('3-slice horizontal'))
  await wait(800)
  const horiz = Object.values(await slicesOnDisk())[0]
  check('slices.json has the horizontal 3-slice', !!horiz && horiz['t'] === 0 && horiz['b'] === 0 && horiz['l']! > 0, JSON.stringify(horiz))
  await snap('s3-horizontal')

  check('Clear clicked', await clickText('Clear'))
  await wait(800)
  check('slices.json is empty again', Object.keys(await slicesOnDisk()).length === 0)
  await snap('s4-cleared')
  return bad
}
