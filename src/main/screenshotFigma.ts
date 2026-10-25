import type { BrowserWindow } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import WebSocket from 'ws'
import { PROTOCOL_VERSION, SPEC_VERSION } from '@inkwell-ui/spec'
import { IPC } from '../shared/ipc'
import type { createSession } from './session'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Debug only (`INKWELL_SHOTS_FIGMA=1` + `INKWELL_SHOTS_DIR=<dir>`, separate `--user-data-dir`, no project needed): plays a fake Figma plugin
 * against the real sync server and takes q1-approval (the Allow / Deny prompt, the dot behind it reads "Waiting for approval"), q2-connected,
 * q3-settings (Forget all Figma plugins), q4-forget-confirm, q5-forgotten. Checks that settings.json holds the SHA-256 and never the secret.
 * It really writes `<userData>/settings.json`. Exits 1 when an expectation fails.
 */
export async function runFigmaShots(o: { outDir: string; userData: string; projectDir: string | undefined; win: () => BrowserWindow | undefined; session: ReturnType<typeof createSession> }): Promise<void> {
  await mkdir(o.outDir, { recursive: true })
  const main = (): BrowserWindow => o.win()!
  const js = <T>(code: string): Promise<T> => main().webContents.executeJavaScript(code) as Promise<T>
  const has = (sel: string): Promise<boolean> => js<boolean>(`!!document.querySelector(${JSON.stringify(sel)})`)
  const click = async (sel: string): Promise<void> => {
    if (!(await js<boolean>(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true })()`))) throw new Error(`Not found: ${sel}`)
  }
  const until = async (what: string, fn: () => Promise<boolean> | boolean, ms = 20000): Promise<void> => {
    const t0 = Date.now()
    while (!(await fn())) {
      if (Date.now() - t0 > ms) throw new Error(`Timed out waiting for ${what}`)
      await wait(100)
    }
  }
  const snap = async (name: string): Promise<void> => {
    await wait(600)
    await writeFile(join(o.outDir, `${name}.png`), (await main().webContents.capturePage()).toPNG())
    console.log(`[shots] ${name}`)
  }
  let failed = false
  const check = (what: string, ok: boolean): void => {
    console.log(`[shots] ${ok ? 'OK' : 'FAILED'}: ${what}`)
    if (!ok) failed = true
  }
  const secret = Array.from({ length: 32 }, (_, i) => ((i * 37 + 11) & 255).toString(16).padStart(2, '0')).join('')
  const dot = (): Promise<string> => js<string>(`document.querySelector('[data-testid="dot-figma"]')?.getAttribute('aria-label') ?? ''`)

  main().setContentSize(1440, 860)
  await until('window', () => !!o.win() && !main().webContents.isLoading())
  await wait(1500)
  if (o.projectDir) await o.session.open(o.projectDir) // the status bar (with the Figma dot) shows only with a project
  await wait(1000)
  await until('server', () => !!o.session.getSync().port)
  const msgs: { type: string; [k: string]: unknown }[] = []
  const ws = new WebSocket(`ws://127.0.0.1:${o.session.getSync().port}/`, { headers: { Origin: 'null' } })
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())))
  await new Promise((r) => ws.on('open', r))
  ws.send(JSON.stringify({ type: 'hello', pluginVersion: '0.2.0', protocolVersion: PROTOCOL_VERSION, specVersion: SPEC_VERSION, pluginSecret: secret, fileName: 'Skyrim HUD concept' }))
  await until('prompt', () => has('[data-testid="figma-approval"]'))
  check('plugin got pending', msgs[0]?.type === 'pending')
  check('Figma dot reads Waiting for approval', (await dot()).includes('Waiting for approval'))
  console.log('[shots] prompt:', await js<string>(`document.querySelector('[data-testid="figma-approval"]').textContent`))
  await snap('q1-approval')
  await click('[data-testid="approval-allow"]')
  await until('connected', () => o.session.getSync().connections === 1)
  check('plugin got helloAck ok', msgs.some((m) => m.type === 'helloAck' && m.ok === true))
  await until('dot', async () => (await dot()).includes('Synced'))
  check('Figma dot reads Synced (connected)', true)
  await snap('q2-connected')
  main().setContentSize(960, 700) // the minimum window width: the status bar keeps both dots visible
  await js(`(() => { const t = document.querySelector('[data-testid="timing"]'); t.textContent = 'Last build: 1234 ms [sync 12 ms · codegen 340 ms · swf 220 ms · ffdec 410 ms · preview 252 ms] over the 1000 ms target'; })()`) // worst case: a long timing line
  await wait(400)
  check('status bar dots fit at the minimum width', await js<boolean>(`(() => { const r = document.querySelector('[data-testid="dot-game"]').getBoundingClientRect(); return r.right <= window.innerWidth && r.left >= 0 })()`))
  await snap('q2n-narrow')
  main().setContentSize(1440, 860)
  // Inkwell -> Figma (protocol 5): with the plugin approved and connected, Select / Focus in Figma are enabled and reach it
  await click('.layer-main')
  await until('inspector', () => has('[data-testid="select-in-figma"]'))
  check('Select in Figma is enabled while the plugin is connected', await js<boolean>(`document.querySelector('[data-testid="select-in-figma"]').getAttribute('aria-disabled') === null`))
  await click('[data-testid="select-in-figma"]')
  await until('selectNode', () => msgs.some((m) => m.type === 'selectNode'))
  check('plugin got selectNode {nodeId} without focus', msgs.some((m) => m.type === 'selectNode' && typeof m.nodeId === 'string' && m.focus === false))
  await js(`document.querySelector('[data-testid="figma-source"]').open = true`)
  await click('[data-testid="focus-in-figma"]')
  await until('focus', () => msgs.some((m) => m.type === 'selectNode' && m.focus === true))
  check('plugin got selectNode with focus', true)
  await snap('q2s-select-in-figma')
  const file = await readFile(join(o.userData, 'settings.json'), 'utf8')
  check('settings.json holds a 64-hex hash and not the secret', !file.includes(secret) && /"figmaPlugins": \[\s*"[0-9a-f]{64}"/.test(file))

  main().webContents.send(IPC.menuSettings)
  await until('settings', () => has('[data-testid="figma-forget"]'))
  await wait(300)
  await js(`document.querySelector('[data-testid="figma-plugins"]').scrollIntoView({ block: 'start' })`)
  await snap('q3-settings')
  await click('[data-testid="figma-forget"]')
  await until('confirm', () => has('[data-testid="figma-forget-confirm"]'))
  await snap('q4-forget-confirm')
  await click('[data-testid="figma-forget-yes"]')
  await until('forgotten', () => has('[data-testid="figma-plugins-msg"]'))
  await snap('q5-forgotten')
  await until('plugin dropped', () => o.session.getSync().connections === 0)
  check('plugin was disconnected', true)
  check('settings.json no longer lists the plugin', !/figmaPlugins/.test(await readFile(join(o.userData, 'settings.json'), 'utf8')))
  ws.terminate()
  console.log(failed ? '[shots] FAILED' : '[shots] all OK')
  process.exit(failed ? 1 : 0)
}
