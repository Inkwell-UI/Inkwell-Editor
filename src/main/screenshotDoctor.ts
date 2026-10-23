import { app, type BrowserWindow } from 'electron'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { createSession } from './session'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const ROW: Record<string, string> = { javaPath: 'java', ffdecDir: 'ffdec', papyrusExe: 'papyrus', creationKitSources: 'papyrus', skyrimPath: 'skyrim', figmaManifest: 'figma', mo2ModsDir: 'mo2', mo2ModName: 'mo2', mo2OverwriteDir: 'mo2' }
interface Field { value: string; badge: string; readOnly: boolean; problem: string; error: string; busy: boolean; row: string; detail: string; browseDisabled: boolean; clearDisabled: boolean }

/**
 * Debug only (`INKWELL_DOCTOR_DRIVER=1`, `INKWELL_SHOTS_PROJECT=<scratch project copy>`, optional `INKWELL_SHOTS_DIR`, a separate `--user-data-dir`): drives the
 * Setup Doctor modal in the real window. It types into every path field (Enter, blur), browses with the native dialog answered by `dialog.answer`,
 * clears, tests env overrides, a wrong path / a file / a valid path per field, a double commit, the Deploy dropdown, and logs each layer (preload result, settings.json on disk,
 * doctor rows). `INKWELL_DOCTOR_PHASE=2` (a second start with the same user-data dir) only checks the saved values come back. `INKWELL_DOCTOR_LEGACY=1` runs the few steps
 * that exist in the first version of the panel (for reproducing the bug on old code). Exits 1 when an expectation fails. Never point it at anything you care about.
 */
export async function runDoctorDriver(o: {
  outDir: string
  projectDir: string | undefined
  win: () => BrowserWindow | undefined
  session: ReturnType<typeof createSession>
  dialog: { answer: string | null | undefined }
}): Promise<void> {
  await mkdir(o.outDir, { recursive: true })
  const main = (): BrowserWindow => o.win()!
  const js = <T>(code: string): Promise<T> => main().webContents.executeJavaScript(code) as Promise<T>
  const q = JSON.stringify
  const fails: string[] = []
  const log = (...a: unknown[]): void => console.log('[driver]', ...a)
  const expect = (name: string, ok: boolean, detail?: unknown): void => {
    log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : `-> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
    if (!ok) fails.push(name)
  }
  const snap = async (name: string): Promise<void> => {
    await wait(500)
    await writeFile(join(o.outDir, `${name}.png`), (await main().webContents.capturePage()).toPNG())
    log('screenshot', name)
  }
  const click = (sel: string): Promise<boolean> => js<boolean>(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return false; e.click(); return true })()`)
  const has = (sel: string): Promise<boolean> => js<boolean>(`!!document.querySelector(${q(sel)})`)
  const until = async (what: string, fn: () => boolean | Promise<boolean>, ms = 60000): Promise<void> => {
    const t0 = Date.now()
    while (!(await fn())) {
      if (Date.now() - t0 > ms) throw new Error(`Timed out waiting for ${what}`)
      await wait(100)
    }
  }
  const settled = async (): Promise<void> => {
    await wait(250)
    await until('busy rows', () => js<boolean>(`!document.querySelector('[data-busy="true"], .doctor-row[data-status="checking"]')`))
    await wait(150)
  }
  const field = (key: string): Promise<Field> =>
    js<Field>(`(() => {
      const f = document.querySelector('[data-testid="field-${key}"]'); const row = document.querySelector('[data-testid="doctor-${ROW[key]}"]')
      const t = (s) => document.querySelector(s)?.textContent ?? ''
      if (!f) return null
      return { value: f.querySelector('input').value, badge: t('[data-testid="source-${key}"]'), readOnly: f.querySelector('input').readOnly,
        problem: t('[data-testid="problem-${key}"]'), error: t('[data-testid="error-${key}"]'), busy: f.dataset.busy === 'true',
        row: row?.dataset.status ?? '', detail: t('[data-testid="doctor-detail-${ROW[key]}"]'),
        browseDisabled: f.querySelector('[data-testid="browse-${key}"]')?.getAttribute('aria-disabled') === 'true',
        clearDisabled: f.querySelector('[data-testid="clear-${key}"]')?.getAttribute('aria-disabled') === 'true' }
    })()`)
  const file = join(app.getPath('userData'), 'settings.json')
  const disk = async (): Promise<Record<string, unknown>> => JSON.parse(await readFile(file, 'utf8').catch(() => '{}')) as Record<string, unknown>
  const type = async (key: string, v: string, commit: 'enter' | 'blur'): Promise<void> => {
    await js(`(() => { const i = document.querySelector('[data-testid="setting-${key}"]'); i.focus(); i.select() })()`)
    main().webContents.insertText(v)
    await until('typed text', () => js<boolean>('document.activeElement.value === ' + q(v))) // insertText is asynchronous; a key sent before it lands commits the old text
    if (commit === 'enter') for (const t of ['keyDown', 'keyUp'] as const) main().webContents.sendInputEvent({ type: t, keyCode: 'Return' })
    else await js(`document.activeElement.blur()`)
    await settled()
  }
  const browse = async (key: string, answer: string | null): Promise<void> => {
    o.dialog.answer = answer
    if (!(await click(`[data-testid="browse-${key}"]`))) throw new Error(`no browse button for ${key}`)
    await settled()
  }

  await until('window', () => !!o.win() && !o.win()!.webContents.isLoading())
  main().setContentSize(1440, 1000)
  main().center()
  if (!o.projectDir) throw new Error('INKWELL_SHOTS_PROJECT is not set')
  const opened = await o.session.open(o.projectDir)
  if (!opened.ok) throw new Error(`open failed: ${JSON.stringify(opened)}`)
  await wait(1500)
  await until('open-setup button', () => has('[data-testid="open-setup"]'))
  await click('[data-testid="open-setup"]')
  await wait(1500)
  const rows = await js<number>(`document.querySelectorAll('.doctor-row').length`)
  log('modal open; rows:', rows)

  const scratch = await mkdtemp(join(tmpdir(), 'inkwell-doctor-drv-'))
  const p = (...s: string[]): string => join(scratch, ...s)

  if (process.env['INKWELL_DOCTOR_LEGACY']) {
    // the first version of the panel: only the three Deploy rows are inputs; check rows have Browse buttons (doctor-fix-<id>)
    await mkdir(p('mods'), { recursive: true })
    const dom = (): Promise<unknown> => js(`({ rows: document.querySelectorAll('.doctor-row').length, running: document.querySelector('[data-testid="doctor-rerun"]')?.getAttribute('aria-disabled'), mods: document.querySelector('[data-testid="setting-mo2ModsDir"]')?.value, java: document.querySelector('[data-testid="doctor-java"]')?.dataset.status, summary: document.querySelector('.doctor-head [role="status"]')?.textContent })`)
    log('legacy: DOM after open', JSON.stringify(await dom()))
    await snap('legacy-a-open')
    await js(`(() => { const i = document.querySelector('[data-testid="setting-mo2ModsDir"]'); if (i) { i.focus(); i.select() } })()`)
    main().webContents.insertText(p('mods'))
    for (const t of ['keyDown', 'keyUp'] as const) main().webContents.sendInputEvent({ type: t, keyCode: 'Return' })
    await wait(2500)
    log('legacy: typed', p('mods'), '+ Enter; DOM', JSON.stringify(await dom()), 'disk', JSON.stringify(await disk()))
    await snap('legacy-b-typed')
    o.dialog.answer = p('mods')
    log('legacy: java browse click ->', await click('[data-testid="doctor-fix-java"]'))
    await wait(2500)
    log('legacy: after browse DOM', JSON.stringify(await dom()), 'disk', JSON.stringify(await disk()))
    await snap('legacy-c-browsed')
    app.exit(0)
    return
  }

  if (process.env['INKWELL_DOCTOR_PHASE'] === '2') {
    await until('rows', () => js<boolean>(`document.querySelectorAll('.doctor-row').length === 9 && !document.querySelector('[data-testid="doctor-rerun"][aria-disabled="true"]')`))
    const want = JSON.parse(await readFile(join(app.getPath('userData'), 'expected.json'), 'utf8')) as Record<string, string>
    for (const [k, v] of Object.entries(want)) {
      const f = await field(k)
      expect(`restart: ${k} shows the saved value`, f.value === v && f.badge === 'saved setting', f)
    }
    await snap('dr-z-after-restart')
    log(fails.length ? `FAILED: ${fails.join('; ')}` : 'all expectations passed')
    app.exit(fails.length ? 1 : 0)
    return
  }

  await until('rows', () => js<boolean>(`document.querySelectorAll('.doctor-row').length === 9 && !document.querySelector('[data-testid="doctor-rerun"][aria-disabled="true"]')`))
  expect('9 check rows (mo2 added)', rows === 9 || (await js<number>(`document.querySelectorAll('.doctor-row').length`)) === 9)
  await snap('dr-a-before')

  // scratch material
  const sky = p('Skyrim Special Edition')
  await mkdir(join(sky, 'Data', 'mods'), { recursive: true })
  await writeFile(join(sky, 'SkyrimSE.exe'), 'x')
  for (const d of ['mods', 'overwrite', 'ck', 'folder']) await mkdir(p(d), { recursive: true })
  await writeFile(p('afile.txt'), 'x')
  await writeFile(p('papyrus.exe'), 'x')
  await writeFile(p('manifest.json'), '{}')
  await writeFile(p('fake-java.exe'), 'x')
  const realJava = (() => { try { return execFileSync('where', ['java'], { encoding: 'utf8' }).split(/\r?\n/)[0]!.trim() } catch { return '' } })()
  const nope = p('does-not-exist')

  // layer probe: what each layer returns for a wrong value and for a good one
  for (const [key, v] of [['mo2ModsDir', nope], ['mo2ModsDir', p('mods')]] as const) {
    const pre = await js<unknown>(`window.inkwell.setSetting(${q(key)}, ${q(v)}).then((r) => ({ ok: r.ok, value: r.settings?.${key}, source: r.settings?.source.${key}, problem: r.settings?.problems?.${key}, error: r.error }), (e) => ({ rejected: String(e) }))`)
    log(`layer preload/IPC/session setSetting(${key}, ${v}) ->`, JSON.stringify(pre))
    log('layer disk settings.json ->', JSON.stringify(await disk()))
    log('layer doctor mo2 ->', JSON.stringify((await o.session.runDoctor(['mo2'])).map((r) => [r.id, r.status, r.detail])))
  }
  await js(`window.inkwell.setSetting('mo2ModsDir', null)`)

  const modsDirCase = async (name: string, key: string, v: string, how: 'enter' | 'blur', e: { problem?: RegExp | null; row?: string; detail?: RegExp; error?: RegExp; saved?: boolean }): Promise<Field> => {
    await type(key, v, how)
    const f = await field(key)
    const d = await disk()
    log(`${name}: ${how} ${key}=${v}`, JSON.stringify(f), 'disk', JSON.stringify(d[key]))
    if (e.saved !== false) expect(`${name}: field shows the value`, f.value === v, f)
    if (e.saved !== false) expect(`${name}: stored on disk`, d[key] === v, d[key])
    if (e.saved === false) expect(`${name}: refused, not stored`, d[key] === undefined || d[key] !== v, d[key])
    if (e.problem === null) expect(`${name}: no problem shown`, f.problem === '', f.problem)
    else if (e.problem) expect(`${name}: problem shown`, e.problem.test(f.problem), f.problem)
    if (e.error) expect(`${name}: inline error`, e.error.test(f.error), f.error)
    if (e.row) expect(`${name}: row status ${e.row}`, f.row === e.row, f.row)
    if (e.detail) expect(`${name}: row detail`, e.detail.test(f.detail), f.detail)
    expect(`${name}: no spinner left`, !f.busy)
    return f
  }

  // Deploy folders (mo2 row)
  await modsDirCase('mods wrong', 'mo2ModsDir', nope, 'enter', { problem: /does not exist/, row: 'fail', detail: /does not exist/ })
  await snap('dr-b-wrong-path')
  await modsDirCase('mods is a file', 'mo2ModsDir', p('afile.txt'), 'blur', { problem: /is a file, not a folder/, row: 'fail' })
  await modsDirCase('mods valid', 'mo2ModsDir', p('mods'), 'enter', { problem: null, row: 'pass', detail: /is writable/ })
  await modsDirCase('mods quoted (Copy as path)', 'mo2ModsDir', `"${p('overwrite')}"`, 'enter', { saved: false })
  expect('mods quoted: stored without quotes', (await disk())['mo2ModsDir'] === p('overwrite'), (await disk())['mo2ModsDir'])
  await modsDirCase('mods valid again', 'mo2ModsDir', p('mods'), 'enter', { problem: null, row: 'pass' })
  await modsDirCase('mod name with a path', 'mo2ModName', 'a\\b', 'enter', { saved: false, error: /not a path/ })
  await modsDirCase('mod name valid', 'mo2ModName', 'Test Mod', 'enter', { problem: null, row: 'pass', detail: /Test Mod/ })
  await modsDirCase('overwrite valid', 'mo2OverwriteDir', p('overwrite'), 'blur', { problem: null, row: 'pass', detail: /Overwrite folder .* writable/ })
  await modsDirCase('skyrim fake (for the Data guard)', 'skyrimPath', sky, 'enter', { problem: null })
  await modsDirCase('mods inside Data', 'mo2ModsDir', join(sky, 'Data', 'mods'), 'enter', { row: 'fail', detail: /inside the game's Data folder/ })
  await snap('dr-c-inside-data')
  await modsDirCase('mods back to valid', 'mo2ModsDir', p('mods'), 'enter', { problem: null, row: 'pass' })

  // double commit: Enter then blur right after (the old code saved twice concurrently)
  await js(`(() => { const i = document.querySelector('[data-testid="setting-mo2OverwriteDir"]'); i.focus(); i.select() })()`)
  main().webContents.insertText(p('folder'))
  await until('typed text', () => js<boolean>('document.activeElement.value === ' + q(p('folder'))))
  for (const t of ['keyDown', 'keyUp'] as const) main().webContents.sendInputEvent({ type: t, keyCode: 'Return' })
  await js(`document.activeElement.blur()`)
  await settled()
  expect('double commit: stored once, valid json', (await disk())['mo2OverwriteDir'] === p('folder'), await disk())
  expect('no leftover .tmp files in user data', !(await readdir(app.getPath('userData'))).some((n) => n.endsWith('.tmp')), await readdir(app.getPath('userData')))

  // path settings of the check rows
  const proj = (): boolean => !!o.session.getProject()
  await modsDirCase('java nonexistent', 'javaPath', p('nojava.exe'), 'enter', { problem: /does not exist/, row: 'fail' })
  await modsDirCase('java is a folder', 'javaPath', p('folder'), 'enter', { problem: /is a folder, not a file/, row: 'fail' })
  await modsDirCase('java is not an exe', 'javaPath', p('afile.txt'), 'enter', { problem: /is not java\.exe/, row: 'fail' })
  await modsDirCase('java fake exe', 'javaPath', p('fake-java.exe'), 'enter', { problem: null, row: 'fail' })
  expect('project still open after a Java change', proj())
  expect('modal still mounted after a Java change (project reopened)', await has('[data-testid="setup-doctor"]'))
  log('sync ffdec state after java change:', JSON.stringify(o.session.getSync().ffdec))
  if (realJava) await modsDirCase('java real', 'javaPath', realJava, 'enter', { problem: null, row: 'pass', detail: /Java \d+ found/ })
  await modsDirCase('ffdec nonexistent', 'ffdecDir', nope, 'enter', { problem: /does not exist/, row: 'fail' })
  await modsDirCase('ffdec wrong folder', 'ffdecDir', p('folder'), 'enter', { problem: /no lib.ffdec_lib\.jar/, row: 'fail' })
  await modsDirCase('ffdec is a file', 'ffdecDir', p('afile.txt'), 'enter', { problem: /is a file, not a folder/ })
  await modsDirCase('papyrus nonexistent', 'papyrusExe', p('nope.exe'), 'enter', { problem: /does not exist/, row: 'fail' })
  await modsDirCase('papyrus is a folder', 'papyrusExe', p('folder'), 'enter', { problem: /is a folder, not a file/ })
  await modsDirCase('papyrus fake exe', 'papyrusExe', p('papyrus.exe'), 'enter', { problem: null })
  await modsDirCase('CK sources valid', 'creationKitSources', p('ck'), 'blur', { problem: null })
  await modsDirCase('CK sources is a file', 'creationKitSources', p('afile.txt'), 'blur', { problem: /is a file, not a folder/ })
  await modsDirCase('skyrim wrong folder', 'skyrimPath', p('folder'), 'enter', { problem: /no SkyrimSE\.exe/ })
  await modsDirCase('skyrim valid fake', 'skyrimPath', sky, 'enter', { problem: null })
  await modsDirCase('figma nonexistent', 'figmaManifest', p('nope.json'), 'enter', { problem: /does not exist/, row: 'warn' })
  await modsDirCase('figma is a folder', 'figmaManifest', p('folder'), 'enter', { problem: /is a folder, not a file/ })
  await modsDirCase('figma not json', 'figmaManifest', p('afile.txt'), 'enter', { problem: /is not the plugin manifest/ })
  await modsDirCase('figma valid', 'figmaManifest', p('manifest.json'), 'enter', { problem: null })
  await snap('dr-d-after-typing')

  // Browse with the native dialog answered by the driver
  await js(`document.querySelector('.dialog').scrollTop = 0`)
  for (const [key, v] of [['mo2ModsDir', p('overwrite')], ['mo2OverwriteDir', p('mods')], ['creationKitSources', p('mods')], ['papyrusExe', p('papyrus.exe')], ['figmaManifest', p('manifest.json')], ['skyrimPath', sky], ['ffdecDir', p('ck')], ['javaPath', p('fake-java.exe')]] as const) {
    await browse(key, v)
    const f = await field(key)
    const d = await disk()
    log(`browse ${key} -> ${v}`, JSON.stringify(f), 'disk', JSON.stringify(d[key]))
    expect(`browse ${key}: field filled`, f.value === v, f)
    expect(`browse ${key}: stored on disk`, d[key] === v, d[key])
    expect(`browse ${key}: row re-checked`, f.row !== 'checking' && f.row !== '', f.row)
  }
  await browse('mo2ModsDir', null)
  expect('browse cancelled: nothing changes', (await field('mo2ModsDir')).value === p('overwrite') && !(await field('mo2ModsDir')).error)
  await browse('ffdecDir', p('afile.txt'))
  expect('browse a file for a folder setting: problem shown on the row', /is a file, not a folder/.test((await field('ffdecDir')).problem), await field('ffdecDir'))
  await snap('dr-e-after-browse')
  // the fix button of a check row (not the field's own Browse) uses the same flow
  await browse('mo2ModsDir', p('mods'))

  // Clear
  await click('[data-testid="clear-papyrusExe"]')
  await settled()
  const cl = await field('papyrusExe')
  expect('clear: value removed on screen and on disk', cl.value === '' && (await disk())['papyrusExe'] === undefined, cl)

  // environment override: shown read-only with its variable, Browse/Clear disabled with the reason
  process.env['INKWELL_PAPYRUS'] = p('papyrus.exe')
  await click('[data-testid="doctor-rerun"]')
  await settled()
  await until('env value shown', async () => (await field('papyrusExe')).readOnly, 15000)
  await wait(500) // the input follows the settings one effect later
  const ev = await field('papyrusExe')
  expect('env override: read-only, badge names the variable, buttons disabled', ev.readOnly && ev.badge === 'from INKWELL_PAPYRUS' && ev.browseDisabled && ev.clearDisabled && ev.value === p('papyrus.exe'), ev)
  await snap('dr-f-env')
  delete process.env['INKWELL_PAPYRUS']
  await click('[data-testid="doctor-rerun"]')
  await settled()

  // a failing write (settings.json replaced by a folder): the reason is shown on the row, nothing is swallowed
  const bad = await js<unknown>(`window.inkwell.setSetting('mo2ModName', 'x\\ny').then((r) => r, (e) => ({ rejected: String(e) }))`)
  expect('control characters are refused with a reason (IPC result)', (bad as { ok: boolean; error?: string }).ok === false && !!(bad as { error?: string }).error, bad)

  // Deploy dropdown reflects the change immediately (a Java or FFDec that does not work disables Deploy, so put the defaults back first)
  await js(`Promise.all([window.inkwell.setSetting('javaPath', null), window.inkwell.setSetting('ffdecDir', null)])`)
  await until('ffdec found again', () => o.session.getSync().ffdec?.status !== 'notFound', 30000)
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await wait(400)
  await click('[data-testid="deploy"]')
  await until('deploy menu', () => has('[data-testid="deploy-mo2Mod"]'))
  const menu = await js<string>(`document.querySelector('[data-testid="deploy-mo2Mod"]').innerText + ' || ' + document.querySelector('[data-testid="deploy-mo2Overwrite"]').innerText`)
  log('deploy menu:', menu.replace(/\n/g, ' | '))
  expect('deploy menu shows mods\\Test Mod', menu.includes(join(p('mods'), 'Test Mod')), menu)
  await snap('dr-g-deploy-menu')
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)

  // end state for the restart phase
  const final = await disk()
  const keep: Record<string, string> = {}
  for (const k of ['mo2ModsDir', 'mo2ModName', 'mo2OverwriteDir', 'skyrimPath', 'figmaManifest', 'creationKitSources']) if (typeof final[k] === 'string') keep[k] = final[k] as string
  await writeFile(join(app.getPath('userData'), 'expected.json'), JSON.stringify(keep))
  log('final settings.json:', JSON.stringify(final))
  log(existsSync(file) ? 'settings.json exists' : 'settings.json missing')
  log(fails.length ? `FAILED (${fails.length}): ${fails.join('; ')}` : 'all expectations passed')
  app.exit(fails.length ? 1 : 0)
}
