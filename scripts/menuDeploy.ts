// yarn deploy:menu-slice | deploy:menu-nodes [-- --flat] [--dev] [--dll <Inkwell.dll>] [--to <mods\name>] -> builds samples/menu-slice and deploys it through the editor's deploy code path (prepareDeploy, export gate,
// commitDeploy) into an MO2 mod folder (default: the project's deploy.path "Inkwell Menu Test"), then copies the runtime DLL (arg --dll, INKWELL_RUNTIME_DLL, else the local runtime build)
// to SKSE\Plugins\Inkwell.dll in that folder. --flat = the O2 fallback layout (Interface\<MenuName>.swf; flatMenuSettings). Never the game's Data folder, never another mod's folder.
// --dev = a Dev deploy (docs/dev-mode.md): the dev SWF, Inkwell.ini with DevMode=1, Token and Port; the token is also stored in the editor user settings (devLinks of this project, %APPDATA%/inkwell-editor/settings.json,
// or INKWELL_USER_DATA/settings.json) so the editor finds it. The runtime check ESP is only built when INKWELL_PAPYRUS points at a compiler (unset it for a deploy without it).
// The DLL is a deploy artefact of the MO2 folder only (not tracked by the manifest, never committed). Needs Java, FFDec, the wrapper jar and.
import { copyFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { Swf } from '@inkwell-ui/spec'
import { createFfdecWrapper } from '../src/main/build/ffdecWrapper'
import { loadCodegenPacks } from '../src/main/codegen/packs'
import { commitDeploy, prepareDeploy, type DeployInput } from '../src/main/deploy/run'
import { exportGate } from '../src/main/lint/gate'
import { loadProject } from '../src/main/project'
import { generateToken } from '../src/main/runtime/devIni'
import { withDevToken } from '../src/main/runtime/token'
import { loadSettings, saveSettings } from '../src/main/settings'
import { compileSwf } from '../src/main/swf/compile'
import { defaultMenuSettings, flatMenuSettings } from '../src/shared/menu'
import { listSettings } from '../src/shared/overlay'

const root = resolve(__dirname, '..')
const arg = (k: string): string | undefined => {
  const i = process.argv.indexOf(k)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const sha = (f: string): Promise<string> => new Promise((ok, no) => { const h = createHash('sha256'); createReadStream(f).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', no) })

export async function runMenuDeploy(o: { sample: string; envVar: string; script: string }): Promise<void> {
  try {
    await main(o)
  } catch (e: unknown) {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  }
}

async function main(o: { sample: string; envVar: string; script: string }): Promise<void> {
  const flat = process.argv.includes('--flat')
  const devDeploy = process.argv.includes('--dev')
  const dll = resolve(arg('--dll') ?? process.env['INKWELL_RUNTIME_DLL'] ?? 'D:/Mods/Inkwell/Inkwell-Runtime/build/Release/Inkwell.dll')
  if (!existsSync(dll)) throw new Error(`Runtime DLL not found: ${dll} (--dll or INKWELL_RUNTIME_DLL)`)
  const projectDir = resolve(root, 'samples', o.sample)
  const project = await loadProject(projectDir)
  const dest = resolve(arg('--to') ?? process.env[o.envVar] ?? project.meta.deploy?.path ?? '')
  if (!/[\\/]mods[\\/][^\\/]+$/i.test(dest) || /[\\/]data([\\/]|$)/i.test(dest)) throw new Error(`Refusing to deploy to ${dest}: it must be one MO2 mod folder (...\\mods\\<name>), never a game Data folder.`)
  const s = project.swfs['menu']!
  const nodes = (s.overlay as { nodes?: Record<string, { instanceName?: string; role?: string; list?: unknown }> }).nodes ?? {}
  const modId = project.meta.modId
  const base = s.menu ?? defaultMenuSettings()
  const ffdec = createFfdecWrapper({
    javaPath: process.env['INKWELL_JAVA'] ?? 'java',
    ffdecDir: process.env['INKWELL_FFDEC'] ?? 'C:\\Program Files (x86)\\FFDec',
    jarPath: resolve(root, 'tools/ffdec-wrapper/build/ffdec-wrapper.jar')
  })
  try {
    const { packs } = await loadCodegenPacks([resolve(root, 'resources/packs/core')])
    const buildDir = mkdtempSync(resolve(tmpdir(), 'inkwell-deploy-'))
    const ir = Swf.parse(s.ir)
    const built = await compileSwf(ir, {
      modId, buildDir, outPath: resolve(buildDir, 'menu.swf'), ffdec,
      instanceNames: Object.fromEntries(Object.entries(nodes).flatMap(([id, o]) => (o.instanceName ? [[id, o.instanceName]] : []))),
      roles: Object.fromEntries(Object.entries(nodes).flatMap(([id, o]) => (o.role ? [[id, o.role]] : []))),
      lists: listSettings(nodes),
      graphs: { graphs: Object.values(s.graphs ?? {}), packs }
    })
    const common = { modId, instanceNames: Object.fromEntries(Object.entries(nodes).flatMap(([id, o]) => (o.instanceName ? [[id, o.instanceName]] : []))), roles: Object.fromEntries(Object.entries(nodes).flatMap(([id, o]) => (o.role ? [[id, o.role]] : []))), lists: listSettings(nodes), graphs: { graphs: Object.values(s.graphs ?? {}), packs }, ffdec }
    let dev: DeployInput['dev']
    if (devDeploy) {
      await compileSwf(ir, { ...common, buildDir: resolve(buildDir, 'dev'), outPath: resolve(buildDir, 'menu.dev.swf'), dev: true })
      const file = resolve(process.env['INKWELL_USER_DATA'] ?? resolve(process.env['APPDATA'] ?? '', 'inkwell-editor'), 'settings.json')
      const w = withDevToken(await loadSettings(file), projectDir, generateToken)
      await saveSettings(file, w.settings)
      dev = { token: w.token, port: w.settings.devLinks![resolve(projectDir).toLowerCase()]!.port ?? 8788 }
      console.log(`dev deploy: token stored in ${file} (devLinks of ${projectDir}), masked ${w.token.slice(0, 4)}...${w.token.slice(-4)}`)
    }
    // the runtime check (message when Inkwell.dll is missing) needs the user's Papyrus compiler: INKWELL_PAPYRUS, else without it the deploy warns `runtime-check-missing`
    const papyrusExe = process.env['INKWELL_PAPYRUS']
    const input: DeployInput = {
      ...(dev ? { dev } : {}), modId, modName: project.meta.name, root: dest, gameDirs: [], buildDir, ffdec, vanillaHashes: new Set(), packs,
      ...(papyrusExe && existsSync(papyrusExe) ? { papyrusExe, stubsDir: resolve(root, 'resources/papyrus-stubs') } : {}),
      swfs: [{
        name: 'menu', orphaned: false, kind: 'customMenu', ir, graphs: Object.values(s.graphs ?? {}), build: { state: 'done', lint: built.lint },
        menu: flat ? flatMenuSettings(modId, 'menu', base) : base
      }]
    }
    const r = await prepareDeploy(input)
    if (!r.ok) throw new Error(r.error)
    for (const l of [...r.prepared.issues, ...r.prepared.lint]) console.log(`${l.severity.padEnd(7)} ${l.code} [${l.nodeId ?? ''}] ${l.message}`)
    const gate = exportGate(r.prepared.issues, false)
    if (!gate.ok) throw new Error(`Export gate blocked: ${gate.blocking.length} error(s).`)
    const c = await commitDeploy(input, r.prepared)
    if (!c.ok) throw new Error(`Deploy failed: ${JSON.stringify(c)}`)
    for (const f of r.prepared.info) console.log(`  ${dest}\\${f.rel.split('/').join('\\')}`)
    const out = resolve(dest, 'SKSE', 'Plugins', 'Inkwell.dll')
    mkdirSync(dirname(out), { recursive: true })
    copyFileSync(dll, out)
    console.log(`  ${out}  (runtime, sha256 ${await sha(out)}${(await sha(out)) === (await sha(dll)) ? ', equals source' : ', DIFFERS from source'})`)
    console.log(`deployed ${flat ? 'flat' : 'sub-path'} layout to ${dest}`)
  } finally {
    ffdec.stop()
  }
}
