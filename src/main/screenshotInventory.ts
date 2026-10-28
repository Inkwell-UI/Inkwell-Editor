import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { createSession } from './session'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Debug only (`INKWELL_SHOTS_INVENTORY=1` + `INKWELL_SHOTS_DIR` + `INKWELL_SHOTS_PROJECT=<scratch copy of samples/inventory-replacement>`): the inventory replacement in the real Ruffle
 * preview with the mock engine (`replacementMock.ts`): categories, the item list with the selection mark, the item card, and Down / Enter keys through the generated Key listener.
 * Prints OK/FAILED per check; states i0, i1. Edits the project it is given: use a copy.
 */
export async function runInventoryShots(o: { outDir: string; projectDir: string; win: () => BrowserWindow | undefined; session: ReturnType<typeof createSession> }): Promise<number> {
  await mkdir(o.outDir, { recursive: true })
  const main = (): BrowserWindow => o.win()!
  const js = <T>(code: string): Promise<T> => main().webContents.executeJavaScript(code) as Promise<T>
  const snap = async (name: string, ms = 400): Promise<void> => {
    await wait(ms)
    await writeFile(join(o.outDir, `${name}.png`), (await main().webContents.capturePage()).toPNG())
    console.log(`[inventory] shot ${name}`)
  }
  const has = (sel: string): Promise<boolean> => js<boolean>(`!!document.querySelector(${JSON.stringify(sel)})`)
  const text = (sel: string): Promise<string> => js<string>(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`)
  const until = async (what: string, fn: () => boolean | Promise<boolean>, ms = 30000): Promise<void> => {
    const t0 = Date.now()
    while (!(await fn())) {
      if (Date.now() - t0 > ms) throw new Error(`Timed out waiting for ${what}`)
      await wait(100)
    }
  }
  const get = (path: string): Promise<string> => js<string>(`String(document.querySelector('ruffle-player').inkwellGet(${JSON.stringify(path)}))`)
  const key = (keyCode: string): void => {
    for (const type of ['keyDown', 'keyUp'] as const) main().webContents.sendInputEvent({ type, keyCode })
  }
  let bad = 0
  const check = (what: string, ok: boolean, detail = ''): void => {
    if (!ok) bad++
    console.log(`[inventory] ${ok ? 'OK    ' : 'FAILED'} ${what}${detail ? `: ${detail}` : ''}`)
  }

  main().setContentSize(1700, 1000)
  main().center()
  const r = await o.session.open(o.projectDir)
  if (!r.ok) throw new Error(`open failed: ${JSON.stringify(r)}`)
  o.session.debug.seedBuilds()
  await wait(1500)
  main().webContents.sendInputEvent({ type: 'keyDown', keyCode: '2', modifiers: ['control'] }) // Behaviour
  await until('Ruffle preview built and drawn', async () => (await text('[data-testid="timing"]')).includes('Ruffle'), 90000)
  await wait(1500) // the mock fills the menu 200 ms after the glue is installed
  const items = await get('Menu_mc.items.text')
  const card = await get('Menu_mc.card.text')
  check('the categories line counts the mock categories', (await get('Menu_mc.cats.text')) === 'Categories: 6', await get('Menu_mc.cats.text'))
  check('the list shows the mock items, the first marked', items.startsWith('> Iron Sword') && items.includes('Lockpick'), JSON.stringify(items))
  check('the item card shows the first item', card.includes('Iron Sword') && card.includes('One-handed sword') && card.includes('weight 9'), JSON.stringify(card))
  await snap('i0')
  await js(`document.querySelector('ruffle-player').focus()`)
  key('Down') // the graph's On Key: Down moves the mark and requests the card
  await wait(600)
  check('Down moves the mark and the card follows', (await get('Menu_mc.items.text')).includes('> Steel Armor') && (await get('Menu_mc.card.text')).includes('Heavy armor'), JSON.stringify([await get('Menu_mc.items.text'), await get('Menu_mc.card.text')]))
  await snap('i1')
  console.log(bad ? `[inventory] ${bad} check(s) FAILED` : '[inventory] all checks passed')
  return bad
}
