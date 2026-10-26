import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import WebSocket from 'ws'
import { defaultMenuSettings, resolveMenuNames } from '../shared/menu'
import { startMockRuntime, type MockRuntime } from './runtime/mockRuntime.testutil'
import type { createSession } from './session'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const TOKEN = '3c'.repeat(32)
const WRONG = 'ee'.repeat(32)

/**
 * Debug only (`INKWELL_SHOTS_DEV=1` + `INKWELL_SHOTS_DIR` + `INKWELL_SHOTS_PROJECT=<scratch copy of samples/menu-nodes>`, optional `INKWELL_MO2_MODS=<scratch folder>` for a real Dev deploy):
 * the game dev connection against a MOCK runtime server (no game involved). Walks the Game dot through its states (no token, connecting, wrong token, connected, spec difference,
 * busy, protocol mismatch, dropped), shows the Trace & Watch panel with game lines, the variable watch and green pin badges on the canvas, Trigger Hot Reload, and a Dev deploy that
 * hot-reloads. Prints OK/FAILED per check. States d0 ... d14. Edits the project it is given: use a copy, and a scratch `--user-data-dir`.
 */
export async function runDevShots(o: { outDir: string; projectDir: string; win: () => BrowserWindow | undefined; session: ReturnType<typeof createSession> }): Promise<number> {
  await mkdir(o.outDir, { recursive: true })
  const main = (): BrowserWindow => o.win()!
  const js = <T>(code: string): Promise<T> => main().webContents.executeJavaScript(code) as Promise<T>
  const snap = async (name: string, ms = 500): Promise<void> => {
    await wait(name.includes('popover') ? 0 : ms)
    main().webContents.invalidate()
    await Promise.race([js('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))'), wait(1500)]) // two real frames, so what was just opened is painted
    await wait(name.includes('popover') ? 80 : 800) // a popover closes by itself a moment after it opens in this driver, so it is captured at once
    if (name.includes('popover')) console.log('[dev] top element at the popover:', await js<string>(`(() => { const p = document.querySelector('[data-testid="game-details"]')?.parentElement; if (!p) return 'no popover'; const r = p.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e ? e.tagName + '.' + e.className + ' inPopover=' + p.contains(e) + ' popClass=' + p.className + ' opacity=' + getComputedStyle(p).opacity : 'null' })()`))
    await writeFile(join(o.outDir, `${name}.png`), (await main().webContents.capturePage()).toPNG())
    console.log(`[dev] shot ${name}`)
  }
  const q = (sel: string): string => JSON.stringify(sel)
  const has = (sel: string): Promise<boolean> => js<boolean>(`!!document.querySelector(${q(sel)})`)
  const must = async (sel: string): Promise<void> => {
    if (!(await js<boolean>(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return false; e.click(); return true })()`))) throw new Error(`Not found: ${sel}`)
  }
  const text = (sel: string): Promise<string> => js<string>(`document.querySelector(${q(sel)})?.textContent ?? ''`)
  const attr = (sel: string, a: string): Promise<string> => js<string>(`document.querySelector(${q(sel)})?.getAttribute(${q(a)}) ?? ''`)
  const until = async (what: string, fn: () => boolean | Promise<boolean>, ms = 15000): Promise<void> => {
    const t0 = Date.now()
    while (!(await fn())) {
      if (Date.now() - t0 > ms) throw new Error(`Timed out waiting for ${what}`)
      await wait(100)
    }
  }
  const key = (keyCode: string, modifiers: ('control' | 'shift')[] = []): void => {
    for (const type of ['keyDown', 'keyUp'] as const) main().webContents.sendInputEvent({ type, keyCode, modifiers })
  }
  let bad = 0
  const check = (what: string, ok: boolean, detail = ''): void => {
    if (!ok) bad++
    console.log(`[dev] ${ok ? 'OK    ' : 'FAILED'} ${what}${detail ? `: ${detail}` : ''}`)
  }
  const phase = (): Promise<string> => attr('[data-testid="dot-game"]', 'data-phase')
  const tone = (): Promise<string> => attr('[data-testid="dot-game"]', 'data-tone')
  const waitPhase = (p: string, ms = 15000): Promise<void> => until(`Game dot phase ${p}`, async () => (await phase()) === p, ms)
  const popover = async (open: boolean): Promise<void> => {
    const isOpen = await has('[data-testid="game-details"]')
    if (isOpen !== open) await must('[data-testid="dot-game"]')
    await wait(200)
  }

  main().webContents.setBackgroundThrottling(false) // the window sits on a workspace that is not shown: keep painting so the captures are current
  main().setContentSize(1700, 1000)
  main().center()
  const r = await o.session.open(o.projectDir)
  if (!r.ok) throw new Error(`open failed: ${JSON.stringify(r)}`)
  o.session.debug.seedBuilds()
  await wait(1500)
  key('2', ['control']) // Behaviour
  await until('graph canvas', () => has('[data-testid="graph-canvas"]'))
  const project = o.session.getProject()!
  const swf = project.swfs.find((s) => s.ir.target.kind === 'customMenu')!
  const menuName = resolveMenuNames(project.modId, { swf: swf.name, settings: swf.menu ?? defaultMenuSettings() }).name
  const menus = [{ name: menuName, swf: `Interface/Inkwell/${project.modId}/Menu.swf`, open: true }, { name: 'OtherMod_Wheel', swf: 'Interface/Inkwell/OtherMod/Wheel.swf', open: false }]
  const mocks: MockRuntime[] = []
  const mock = async (opts: Partial<Parameters<typeof startMockRuntime>[0]> = {}): Promise<MockRuntime> => {
    const m = await startMockRuntime({ token: TOKEN, menus, ...opts })
    mocks.push(m)
    return m
  }
  await until('Ruffle preview built', async () => (await text('[data-testid="timing"]')).includes('Ruffle'), 60000)

  // ---- d0/d1: no project token yet: grey, with the way out
  await waitPhase('noToken')
  check('no token known: the Game dot is grey (noToken)', (await tone()) === 'off', await phase())
  await popover(true)
  check('the popover says how to get a token (UX 5.4)', (await text('[data-testid="game-details"]')).includes('Paste the token from Inkwell.ini or run a Dev deploy'))
  await snap('d1-no-token-popover')
  await popover(false)

  // ---- d2: connecting (amber): a server that accepts but never answers the hello
  const silent = await mock({ silentHello: true })
  await o.session.devSetPort(silent.port)
  await o.session.devSetToken(TOKEN)
  await waitPhase('connecting')
  check('hello sent, no answer yet: amber (connecting)', (await tone()) === 'warn')
  await snap('d2-connecting')
  await silent.close()

  // ---- d3: wrong token (red), no automatic retry
  const game = await mock()
  await o.session.devSetPort(game.port)
  await o.session.devSetToken(WRONG)
  await waitPhase('unauthorized')
  check('wrong token: red (unauthorized) with the message', (await tone()) === 'error')
  await popover(true)
  check('the message names the cause and offers Connect', (await text('[data-testid="game-message"]')).includes('refused the token') && (await has('[data-testid="game-connect"]')))
  await snap('d3-unauthorized-popover')
  const tries = game.connections.length
  await wait(1500)
  check('a refused token is not retried', game.connections.length === tries, `${game.connections.length} connections`)

  // ---- d4: the right token pasted into the popover field: green
  await js(`(() => { const e = document.querySelector('[data-testid="game-token-input"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, ${JSON.stringify(` ${TOKEN.toUpperCase()} `)}); e.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await must('[data-testid="game-token-use"]')
  await waitPhase('connected')
  check('pasted token (sloppy form accepted): green (connected)', (await tone()) === 'ok')
  await wait(400)
  const details = await text('[data-testid="game-details"]')
  check('popover shows runtime version, game version, the menus with open state and the masked token', details.includes('0.3.0') && details.includes('1.6.1170') && details.includes(menuName) && details.includes('open') && details.includes('3c3c...3c3c') && !details.includes(TOKEN), details.slice(0, 200))
  await snap('d4-connected-popover')
  await popover(false)
  check('the mock saw hello without Origin and subscribed to the menus', !('origin' in game.connections.at(-1)!.headers) && game.subs.has(menuName))

  // ---- d5/d6: Trace & Watch, source Game
  await must('[data-testid="tab-trace"]')
  await until('trace panel', () => has('[data-testid="trace-source"]'))
  check('Ruffle preview stays the default source', (await attr('[data-testid="source-ruffle"]', 'aria-checked')) === 'true')
  await must('[data-testid="source-game"]')
  game.send({ type: 'trace', ts: 100, level: 'info', source: 'runtime', text: 'hot reload: reloaded 1 menu' })
  game.send({ type: 'trace', ts: 120, level: 'info', source: 'as2', menu: menuName, node: 'fmtc', text: 'Clicks: 3 shown' })
  game.send({ type: 'trace', ts: 130, level: 'warn', source: 'as2', menu: menuName, node: 'add', text: 'coerced undefined input b -> 0' })
  game.send({ type: 'trace', ts: 140, level: 'error', source: 'as2', menu: menuName, node: 'send', text: 'deliberate error in Send Mod Event' })
  game.send({ type: 'watch', menu: menuName, graph: 'main', scope: 'saved', name: 'clicks', value: 3 })
  game.send({ type: 'watch', menu: menuName, graph: 'main', scope: 'menu', name: 'greeting', value: 'hello' })
  game.send({ type: 'watch', menu: menuName, graph: 'main', scope: 'component', name: 'open', value: true })
  for (const [node, v] of [['fmtc', 'Clicks: 3'], ['add', 4], ['gset', 'default (key absent)'], ['split', 'Alpha,Beta,Gamma'], ['fmts', 'Setting: x'], ['getc', 3], ['gtxt', 'Ping']] as const)
    game.send({ type: 'pin', menu: menuName, node, pin: 'value', value: v })
  await until('game trace lines', async () => (await js<number>(`document.querySelectorAll('[data-testid="trace-lines"] li').length`)) >= 5)
  const lines = await js<string[]>(`[...document.querySelectorAll('[data-testid="trace-lines"] li')].map((e) => e.textContent)`)
  console.log('[dev] game lines:', JSON.stringify(lines))
  check('lines show time, level, source, node title and id, text', lines.some((l) => l.includes('WARN') && l.includes('AS2') && l.includes('#add') && l.includes('coerced undefined input')))
  check('a runtime source line is marked runtime', lines.some((l) => l.includes('runtime') && l.includes('hot reload')))
  const rows = await js<string[]>(`[...document.querySelectorAll('[data-testid="watch-table"] tbody tr')].map((e) => e.textContent)`)
  console.log('[dev] watch rows:', JSON.stringify(rows))
  check('watch table: Component, Menu, Saved order with values', rows.length === 3 && rows[0]!.startsWith('Component') && rows[1]!.startsWith('Menu') && rows[2]!.startsWith('Saved') && rows[2]!.includes('3'))
  await snap('d5-trace-watch-game')
  await must('[data-testid="trace-lines"] li[data-node="add"]')
  await wait(500)
  check('clicking a line selects its graph node', await js<boolean>(`!!document.querySelector('.react-flow__node.selected[data-id="add"]')`))
  const badges = await js<number>(`document.querySelectorAll('[data-testid="pin-value"][data-source="game"]').length`)
  check('green pin badges (source game) show on the canvas', badges > 0, `${badges} badges`)
  await snap('d6-game-pin-badges')
  await must('[data-testid="source-ruffle"]')
  await wait(300)
  check('the Ruffle source hides the game badges', (await js<number>(`document.querySelectorAll('[data-testid="pin-value"][data-source="game"]').length`)) === 0)
  await must('[data-testid="source-game"]')

  // ---- d7: Trigger Hot Reload for the current SWF's menu
  await must('[data-testid="trace-reload"]')
  await until('reload result', async () => (await text('[data-testid="reload-result"]')).includes('reloaded'))
  const rr = await text('[data-testid="reload-result"]')
  check('Trigger Hot Reload sent {reload, menu} and shows the ack with its time', rr.includes(menuName) && rr.includes('42 ms') && game.received.some((m) => m['type'] === 'reload' && m['menu'] === menuName), rr)
  await snap('d7-hot-reload')

  // ---- d8: the game goes away: everything stays, greyed
  game.drop()
  await waitPhase('waiting')
  check('the game closed: grey dot, last session kept and greyed', (await tone()) === 'off' && (await has('[data-testid="trace-greyed"]')) && (await js<number>(`document.querySelectorAll('[data-testid="trace-lines"] li').length`)) >= 5)
  await snap('d8-disconnected-greyed')
  await wait(2500)
  check('it reconnects by itself when the game is back (same mock, new connection)', (await phase()) === 'connected', await phase())
  await game.close()
  await waitPhase('waiting')

  // ---- d9..d11: spec difference (amber), busy (amber), protocol mismatch (red)
  const spec = await mock({ specVersion: 99, port: game.port })
  await o.session.devConnect()
  await waitPhase('connected')
  check('a spec version difference is amber but connected', (await tone()) === 'warn')
  await popover(true)
  await snap('d9-spec-mismatch-popover')
  await popover(false)
  await spec.close()
  await waitPhase('waiting')
  const taken = await mock({ port: game.port })
  const other = new WebSocket(`ws://127.0.0.1:${taken.port}/`)
  await new Promise<void>((res) => other.on('open', () => res()))
  other.send(JSON.stringify({ type: 'hello', token: TOKEN, editorVersion: 'other', protocolVersion: 1, specVersion: 6 }))
  await taken.waitFor(() => taken.connected)
  await o.session.devConnect()
  await waitPhase('busy')
  check('a second editor: amber (busy) with its own message', (await tone()) === 'warn')
  await popover(true)
  check('the busy message differs from the others', (await text('[data-testid="game-message"]')).includes('Another editor'))
  await snap('d10-busy-popover')
  await popover(false)
  other.close()
  await taken.close()
  const old = await mock({ protocolVersion: 2, port: game.port })
  await o.session.devConnect()
  await waitPhase('protocolMismatch')
  check('protocol mismatch: red', (await tone()) === 'error')
  await popover(true)
  check('the message asks to update the editor or the runtime', (await text('[data-testid="game-message"]')).includes('Update the editor or the runtime'))
  await snap('d11-protocol-mismatch-popover')
  await popover(false)
  await old.close()

  // ---- d12..d14: Dev deploy for real into a scratch MO2 folder; hot reload after it
  const modsDir = process.env['INKWELL_MO2_MODS']
  if (modsDir) {
    const live = await mock({ port: game.port, reload: (m) => ({ ok: true, reloaded: m ? [m] : [], ms: 118 }) })
    await o.session.devConnect()
    await waitPhase('connected')
    await must('[data-testid="deploy"]')
    await until('deploy menu', () => has('[data-testid="dev-deploy-toggle"]'))
    check('the Dev deploy toggle is off by default', !(await js<boolean>(`document.querySelector('[data-testid="dev-deploy-toggle"]').checked`)))
    await must('[data-testid="dev-deploy-toggle"]')
    await until('toggle on', () => js<boolean>(`document.querySelector('[data-testid="dev-deploy-toggle"]').checked`))
    await snap('d12-deploy-menu-dev-toggle')
    await wait(2500) // the dev SWF builds with the next build
    await must('[data-testid="deploy-mo2Mod"]')
    await until('confirm dialog', () => has('[data-testid="deploy-confirm"]'), 90000)
    const dialog = await text('[data-testid="deploy-confirm"]')
    check('the confirm dialog lists Inkwell.ini as a dev file and explains the Dev deploy; no token in it', dialog.includes('Inkwell.ini') && dialog.includes('Dev deploy') && !/[0-9a-f]{64}/.test(dialog))
    await snap('d13-dev-deploy-dialog')
    await must('[data-testid="deploy-confirm-ok"]')
    await until('deploy status with hot reload', async () => (await text('[data-testid="deploy-status"]')).includes('hot reload'), 90000)
    const status = await text('[data-testid="deploy-status"]')
    check('the deploy status shows the hot reload ack with its time', status.includes('118 ms') && status.includes(menuName), status)
    check('the game received the reload for the deployed menu', live.received.some((m) => m['type'] === 'reload' && m['menu'] === menuName))
    const root = join(modsDir, project.name)
    const ini = await readFile(join(root, 'SKSE', 'Plugins', 'Inkwell', 'Inkwell.ini'), 'utf8')
    check('Inkwell.ini has DevMode=1, a 64 digit token and the port', ini.includes('DevMode=1') && /Token=[0-9a-f]{64}/.test(ini) && ini.includes(`Port=${game.port}`), ini.replace(/Token=.*/, 'Token=<hidden>'))
    const deployed = await readFile(join(root, 'Interface', 'Inkwell', project.modId, 'Menu.swf'))
    const game0 = await readFile(join(o.projectDir, 'build', `${swf.name}.swf`))
    const dev0 = await readFile(join(o.projectDir, 'build', `${swf.name}.dev.swf`))
    check('the deployed SWF is the dev build, not the normal game build', deployed.equals(dev0) && !deployed.equals(game0), `deployed ${deployed.length} B, dev ${dev0.length} B, game ${game0.length} B`)
    await snap('d14-deploy-status-hot-reload')
  } else console.log('[dev] SKIPPED real Dev deploy: set INKWELL_MO2_MODS to a scratch folder')

  for (const m of mocks) await m.close().catch(() => undefined)
  console.log(bad ? `[dev] ${bad} check(s) FAILED` : '[dev] all checks OK')
  return bad
}
