import { existsSync, statSync } from 'node:fs'
import { readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { CheckResult, Fix, ResolvedSettings } from '../../shared/doctor'
import { FFDEC_PINNED } from '../../shared/ffdec'
import { compilePapyrus } from '../widget/papyrusCompiler'
import { isGameData } from '../deploy/plan'
import { modNameProblem } from '../settings'
import { isInside, vanillaCacheStatus, vanillaCacheRoot } from '../vanilla/cache'
import { exeVersion, findSkyrim, run, runtimeLabel, type Run } from './skyrim'
import { readZipEntry } from './zip'

export interface DoctorContext {
  settings: ResolvedSettings
  appPath: string
  userData: string
  projectDir?: string
  /** Name of the open project: the default mod folder name. */
  projectName?: string
  /** Figma plugins connected to the sync server right now. */
  pluginConnections: number
  /** Injected in tests; defaults to child_process. */
  exec?: Run
}

export const wrapperJarPath = (appPath: string): string => join(appPath, 'tools/ffdec-wrapper/build/ffdec-wrapper.jar')
export const stubsPath = (appPath: string): string => join(appPath, 'resources/papyrus-stubs')
const FFDEC_RELEASES = 'https://github.com/jpexs/jpexs-decompiler/releases'
const JAVA_PAGE = 'https://adoptium.net/temurin/releases/?version=17'
const RUSSO_PAGE = 'https://github.com/russo-2025/papyrus-compiler/releases'
const label = {
  java: 'Java',
  ffdec: 'FFDec',
  wrapper: 'FFDec wrapper',
  papyrus: 'Papyrus compiler',
  skyrim: 'Skyrim install',
  vanilla: 'Vanilla SWF cache',
  projectIgnore: 'Project .gitignore',
  figma: 'Figma plugin',
  mo2: 'MO2 deploy folders',
  skse: 'SKSE64',
  addresslib: 'Address Library',
  runtime: 'Inkwell Runtime',
  skyui: 'SkyUI'
} as const

/** `openjdk version "1.8.0_504"` -> 8, `"17.0.2"` -> 17, `"21"` -> 21. */
export function parseJavaVersion(out: string): number | undefined {
  const m = /version "(\d+)(?:\.(\d+))?/.exec(out)
  if (!m) return undefined
  const major = Number(m[1])
  return major === 1 ? Number(m[2]) : major
}

export async function checkJava(ctx: DoctorContext): Promise<CheckResult> {
  const exec = ctx.exec ?? run
  const out = await exec(ctx.settings.javaPath, ['-version']).catch(() => undefined)
  const v = out === undefined ? undefined : parseJavaVersion(out)
  if (v === undefined)
    return {
      id: 'java', label: label.java, status: 'fail',
      detail: out === undefined ? `Could not run "${ctx.settings.javaPath}". Install a Java runtime (8 or newer) or point Inkwell at java.exe.` : `"${ctx.settings.javaPath}" ran but its version could not be read.`,
      fix: { label: 'Browse for java.exe', action: { kind: 'browse', setting: 'javaPath', folder: false } },
      extra: [{ label: 'Get Java', action: { kind: 'open', url: JAVA_PAGE } }]
    }
  const via = ctx.settings.source.javaPath === 'default' ? 'java on PATH' : `${ctx.settings.javaPath} (${ctx.settings.source.javaPath})`
  return v >= 8
    ? { id: 'java', label: label.java, status: 'pass', detail: `Java ${v} found: ${via}. The wrapper targets Java 8 bytecode, so any Java 8 or newer works.` }
    : { id: 'java', label: label.java, status: 'fail', detail: `Java ${v} is too old; the FFDec wrapper needs Java 8 or newer.`, fix: { label: 'Get Java', action: { kind: 'open', url: JAVA_PAGE } } }
}

/** FFDec's real version: `project.properties` inside `lib/ffdec_lib.jar` (the install's metainfo and changelog lag behind nightly builds). */
export function ffdecVersion(ffdecDir: string): string | undefined {
  try {
    return /^version=(.+)$/m.exec(readZipEntry(join(ffdecDir, 'lib', 'ffdec_lib.jar'), 'project.properties')?.toString('utf8') ?? '')?.[1]?.trim()
  } catch {
    return undefined
  }
}

export async function checkFfdec(ctx: DoctorContext): Promise<CheckResult> {
  const dir = ctx.settings.ffdecDir
  if (!existsSync(join(dir, 'lib', 'ffdec_lib.jar')))
    return {
      id: 'ffdec', label: label.ffdec, status: 'fail',
      detail: `No FFDec in "${dir}" (looked for lib\\ffdec_lib.jar). FFDec is user-installed and never bundled; install it or choose its folder.`,
      fix: { label: 'Browse for the FFDec folder', action: { kind: 'browse', setting: 'ffdecDir', folder: true } },
      extra: [{ label: 'Get FFDec', action: { kind: 'open', url: FFDEC_RELEASES } }]
    }
  const v = ffdecVersion(dir)
  if (!v) return { id: 'ffdec', label: label.ffdec, status: 'warn', detail: `FFDec found in "${dir}", but its version could not be read.` }
  return v === FFDEC_PINNED
    ? { id: 'ffdec', label: label.ffdec, status: 'pass', detail: `FFDec ${v} in "${dir}" (matches the wrapper's pinned version).` }
    : {
        id: 'ffdec', label: label.ffdec, status: 'warn',
        detail: `FFDec ${v} is installed but the wrapper is pinned to ${FFDEC_PINNED}. The wrapper refuses to build on any other version, because FFDec output can change between releases. Install ${FFDEC_PINNED} or rebuild the wrapper for your version.`,
        fix: { label: 'Get FFDec', action: { kind: 'open', url: FFDEC_RELEASES } }
      }
}

export async function checkWrapper(ctx: DoctorContext): Promise<CheckResult> {
  const jar = wrapperJarPath(ctx.appPath)
  if (!existsSync(jar))
    return {
      id: 'wrapper', label: label.wrapper, status: 'fail',
      detail: `The wrapper jar is not built (${jar}). Run "yarn build:wrapper" in the editor repository (needs a JDK 9 or newer).`,
      fix: { label: 'Copy command', action: { kind: 'copy', text: 'yarn build:wrapper' } }
    }
  return {
    id: 'wrapper', label: label.wrapper, status: 'pass',
    detail: 'The wrapper jar is built. The warm-wrapper benchmark compiles the test fixture cold with the FFDec CLI, with the wrapper (first job) and warm (median of 10); it is run on request.',
    fix: { label: 'Run benchmark', action: { kind: 'run', task: 'benchmark' } }
  }
}

const PROBE = 'Scriptname InkwellDoctorProbe extends Quest\n\nFunction Probe()\n  Debug.Trace("inkwell doctor")\n  Utility.Wait(0.1)\nEndFunction\n'

export async function checkPapyrus(ctx: DoctorContext): Promise<CheckResult> {
  const exe = ctx.settings.papyrusExe
  const note = 'The compiler is user-installed (russo-2025 papyrus-compiler) and is not bundled with Inkwell.'
  const ck = ctx.settings.creationKitSources
  const ckNote = ck ? (existsSync(ck) ? ` Creation Kit sources: ${ck}.` : ` Creation Kit sources path "${ck}" does not exist.`) : ' Creation Kit script sources: not set (optional; only the Creation Kit compiler needs them).'
  const browse = { label: 'Browse for papyrus.exe', action: { kind: 'browse', setting: 'papyrusExe', folder: false } } as const
  const extra = [{ label: 'Creation Kit sources...', action: { kind: 'browse', setting: 'creationKitSources', folder: true } } as const, { label: 'Get the compiler', action: { kind: 'open', url: RUSSO_PAGE } } as const]
  if (!exe) return { id: 'papyrus', label: label.papyrus, status: 'warn', detail: `Not set. HUD widgets need it to produce .pex files; without it a deploy writes the SWF only. ${note}${ckNote}`, fix: browse, extra: [...extra] }
  if (!existsSync(exe)) return { id: 'papyrus', label: label.papyrus, status: 'fail', detail: `"${exe}" does not exist. ${note}`, fix: browse, extra: [...extra] }
  const r = await compilePapyrus({ papyrusExe: exe, scripts: [{ name: 'InkwellDoctorProbe', source: PROBE }], workDir: join(ctx.userData, 'doctor', 'papyrus'), stubsDir: stubsPath(ctx.appPath) }).catch((e: unknown) => e instanceof Error ? e : new Error(String(e)))
  if (r instanceof Error) return { id: 'papyrus', label: label.papyrus, status: 'fail', detail: `"${exe}" could not be started (${r.message}). Is it the real papyrus.exe of the russo-2025 compiler? ${note}`, fix: browse, extra: [...extra] }
  const err = r.lint.find((l) => l.severity === 'error')
  if (err || !r.pex['InkwellDoctorProbe']?.length)
    return { id: 'papyrus', label: label.papyrus, status: 'fail', detail: `Test compile against Inkwell's header stubs failed: ${err?.message ?? 'no .pex produced'}. ${note}`, fix: browse, extra: [...extra] }
  return { id: 'papyrus', label: label.papyrus, status: 'pass', detail: `Compiled a probe script against Inkwell's header stubs (${exe}). ${note}${ckNote}`, extra: [extra[0]!] }
}

export interface SkyrimFacts {
  path?: string
  bsa?: string
}

export async function checkSkyrim(ctx: DoctorContext, out: SkyrimFacts = {}): Promise<CheckResult> {
  const found = await findSkyrim({ ...(ctx.settings.skyrimPath ? { manual: ctx.settings.skyrimPath } : {}), ...(ctx.exec ? { exec: ctx.exec } : {}) })
  const manual = { label: 'Browse for the game folder', action: { kind: 'browse', setting: 'skyrimPath', folder: true } } as const
  const first = found[0]
  if (!first) return { id: 'skyrim', label: label.skyrim, status: 'fail', detail: `Skyrim Special Edition was not found through Steam (registry and libraryfolders.vdf) or GOG${ctx.settings.skyrimPath ? `, and "${ctx.settings.skyrimPath}" has no SkyrimSE.exe` : ''}. Choose the game folder (the one with SkyrimSE.exe).`, fix: manual }
  out.path = first.path
  const detected = first.source === 'manual' ? {} : { found: { value: first.path, source: 'detected' as const } }
  const ver = await exeVersion(join(first.path, 'SkyrimSE.exe'), ctx.exec)
  const rt = ver ? runtimeLabel(ver) : undefined
  const bsa = join(first.path, 'Data', 'Skyrim - Interface.bsa')
  const others = found.length > 1 ? ` Also found: ${found.slice(1).map((f) => `${f.path} (${f.source})`).join('; ')}.` : ''
  const ignored = ctx.settings.skyrimPath && first.source !== 'manual' ? `Your setting "${ctx.settings.skyrimPath}" has no SkyrimSE.exe, so the detected install is used instead. ` : ''
  const head = `${ignored}${first.path} (${first.source}); SkyrimSE.exe ${ver ?? 'version unreadable'}${rt ? `, runtime ${rt.label}` : ''}.${others}`
  if (!existsSync(bsa)) return { id: 'skyrim', label: label.skyrim, status: 'fail', detail: `${head} Data\\Skyrim - Interface.bsa is missing; verify the game files in Steam/GOG.`, fix: manual }
  out.bsa = bsa
  return { id: 'skyrim', label: label.skyrim, status: rt?.known ? 'pass' : 'warn', detail: `${head} Skyrim - Interface.bsa is present.${rt && !rt.known ? ' Inkwell has not been checked against this runtime.' : ''}`, extra: [manual], ...detected }
}

export async function checkVanilla(ctx: DoctorContext, bsa: string | undefined): Promise<CheckResult> {
  const root = vanillaCacheRoot(ctx.userData)
  if (!bsa) return { id: 'vanilla', label: label.vanilla, status: 'skipped', detail: `Needs the Skyrim install and its Interface archive. Cache location: ${root}` }
  const s = await vanillaCacheStatus({ bsaPath: bsa, cacheRoot: root })
  if (!s.built)
    return {
      id: 'vanilla', label: label.vanilla, status: 'warn',
      detail: `Not built yet. Extracts the vanilla Interface SWFs from your own archive into ${join(root, s.archiveHash ?? '<archive hash>')} (outside any project). They are never shipped, committed or exported; Deploy uses their hashes to refuse unmodified vanilla files.`,
      fix: { label: 'Build the cache', action: { kind: 'run', task: 'buildVanillaCache' } }
    }
  const inProject = ctx.projectDir && s.dir && isInside(s.dir, ctx.projectDir)
  return {
    id: 'vanilla', label: label.vanilla, status: inProject ? 'fail' : 'pass',
    detail: `${s.entries} SWFs, ${(s.bytes! / 1048576).toFixed(1)} MB, keyed by the archive hash ${s.archiveHash?.slice(0, 12)}: ${s.dir}${inProject ? '. This is inside the open project; it must never be committed or exported.' : ''}`
  }
}

/** Does a .gitignore text exclude the `build/` folder? */
export const ignoresBuild = (text: string): boolean => text.split(/\r?\n/).some((l) => /^\/?build(\/\*?|\/\*\*)?$/.test(l.trim()))

export async function checkProjectIgnore(ctx: DoctorContext): Promise<CheckResult> {
  if (!ctx.projectDir) return { id: 'projectIgnore', label: label.projectIgnore, status: 'skipped', detail: 'No project is open.' }
  const text = await readFile(join(ctx.projectDir, '.gitignore'), 'utf8').catch(() => undefined)
  const inside = isInside(vanillaCacheRoot(ctx.userData), ctx.projectDir)
  if (inside) return { id: 'projectIgnore', label: label.projectIgnore, status: 'fail', detail: 'The vanilla cache folder is inside the open project; vanilla SWFs could be committed.' }
  if (text === undefined) return { id: 'projectIgnore', label: label.projectIgnore, status: 'warn', detail: 'The project has no .gitignore. Add one that excludes build/ (compiled SWFs and extracted files must not be committed).', fix: { label: 'Copy line', action: { kind: 'copy', text: 'build/' } } }
  return ignoresBuild(text)
    ? { id: 'projectIgnore', label: label.projectIgnore, status: 'pass', detail: 'build/ is excluded; the vanilla cache lives outside the project.' }
    : { id: 'projectIgnore', label: label.projectIgnore, status: 'warn', detail: 'The project .gitignore does not exclude build/. Add it so compiled output is never committed.', fix: { label: 'Copy line', action: { kind: 'copy', text: 'build/' } } }
}

/** Plugin manifest: the setting, else the documented sibling checkout `../Inkwell-Figma/plugin/manifest.json` next to the editor. */
export function figmaManifestPath(ctx: DoctorContext): string {
  if (ctx.settings.figmaManifest) return ctx.settings.figmaManifest
  // the portable zip keeps the plugin next to Inkwell.exe (resources/app is the app path); a dev checkout has the sibling repo
  const portable = resolve(ctx.appPath, '..', '..', 'Inkwell-Figma-Plugin', 'manifest.json')
  return existsSync(portable) ? portable : resolve(ctx.appPath, '..', 'Inkwell-Figma', 'plugin', 'manifest.json')
}

export async function checkFigma(ctx: DoctorContext): Promise<CheckResult> {
  const p = figmaManifestPath(ctx)
  const ok = existsSync(p) && statSync(p).isFile()
  const link = ctx.pluginConnections > 0 ? `A plugin is connected now (${ctx.pluginConnections}).` : 'No plugin is connected right now: in Figma Desktop run Plugins > Development > Inkwell, then click Allow when the editor asks.'
  const copy = { label: 'Copy manifest path', action: { kind: 'copy', text: p } } as const
  const browse = { label: 'Browse for manifest.json', action: { kind: 'browse', setting: 'figmaManifest', folder: false } } as const
  const found = ctx.settings.figmaManifest ? {} : { found: { value: p, source: 'default' as const } }
  if (!ok) return { id: 'figma', label: label.figma, status: 'warn', ...found, detail: `Plugin manifest not found at ${p}. Check out the Inkwell-Figma repository next to the editor or choose the manifest. ${link}`, fix: browse, extra: [copy] }
  return { id: 'figma', label: label.figma, status: ctx.pluginConnections > 0 ? 'pass' : 'warn', ...found, detail: `Manifest: ${p}. In Figma Desktop import it via Plugins > Development > Import plugin from manifest. ${link}`, fix: copy, extra: [browse] }
}


/** Creates and removes a temp file in `dir`; the error text when that fails. */
async function writeProbe(dir: string): Promise<string | undefined> {
  const f = join(dir, `.inkwell-write-test-${process.pid}-${Date.now()}`)
  try {
    await writeFile(f, 'x', { flag: 'wx' })
    await unlink(f)
    return undefined
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

/** One deploy folder: not inside the game's Data folder, exists and is a folder, writable (a temp file is created and removed). `create`: it need not exist (the deploy creates it), so its parent is probed. */
export async function folderProblem(dir: string, gameDirs: string[], create = false): Promise<string | undefined> {
  const st = await stat(dir).catch(() => undefined)
  if (isGameData(resolve(dir), gameDirs)) return `${dir} is inside the game's Data folder. Deploy never writes there; use an MO2 folder (MO2's virtual file system puts the files in the game).`
  if (st && !st.isDirectory()) return `${dir} is a file, not a folder.`
  if (!st && !create) return `${dir} does not exist.`
  const probe = await writeProbe(st ? dir : resolve(dir, '..'))
  return probe ? `${dir} is not writable: ${probe}` : undefined
}

export async function checkMo2(ctx: DoctorContext, gameDirs: string[]): Promise<CheckResult> {
  const { mo2ModsDir: mods, mo2ModName: name, mo2OverwriteDir: over } = ctx.settings
  const browseMods: Fix = { label: 'Browse for the mods directory', action: { kind: 'browse', setting: 'mo2ModsDir', folder: true } }
  const browseOver: Fix = { label: 'Browse for the overwrite folder', action: { kind: 'browse', setting: 'mo2OverwriteDir', folder: true } }
  const done = (status: CheckResult['status'], detail: string, fix?: Fix, extra?: Fix[]): CheckResult => ({ id: 'mo2', label: label.mo2, status, detail, ...(fix ? { fix } : {}), ...(extra ? { extra } : {}) })
  if (!mods && !over) return done('warn', 'Not set. Deploy writes into an MO2 mod folder (mods directory + mod name) or the MO2 overwrite folder; choose one. It never writes into the game Data folder.', browseMods, [browseOver])
  const lines: string[] = []
  let fix: Fix | undefined
  let failed = false
  if (mods) {
    const mod = name ?? ctx.projectName
    const nameProblem = name ? modNameProblem(name) : undefined
    const modsProblem = nameProblem ? undefined : await folderProblem(mods, gameDirs)
    const target = mod ? resolve(mods, mod) : undefined
    const targetProblem = nameProblem || modsProblem || !target ? undefined : await folderProblem(target, gameDirs, true)
    failed = !!(nameProblem || modsProblem || targetProblem)
    if (nameProblem) {
      fix = { label: 'Clear the mod name', action: { kind: 'clear', setting: 'mo2ModName' } }
      lines.push(nameProblem)
    } else if (modsProblem) {
      fix = browseMods
      lines.push(`Mods directory: ${modsProblem}`)
    } else if (targetProblem) {
      fix = browseMods
      lines.push(`Mod folder: ${targetProblem}`)
    } else lines.push(`Mod folder ${target ?? mods} is writable (${name ? 'mod name setting' : mod ? 'mod name defaults to the project name' : 'open a project or set a mod name'}).`)
  }
  if (over) {
    const p = await folderProblem(over, gameDirs)
    if (p) (fix ??= browseOver, failed = true)
    lines.push(p ? `Overwrite folder: ${p}` : `Overwrite folder ${over} is writable.`)
  }
  return done(failed ? 'fail' : 'pass', lines.join(' '), fix)
}


// --- the game side, looked up in the MO2 mods directory and the game folder (0.5 Phase 7) ---

/** Files of `sub` (a folder inside each mod, e.g. `SKSE/Plugins`; empty = the mod's root) whose name matches `match`: `{mod, file}` per hit. One level of mod folders only, never the game's Data folder. */
export async function modFiles(mods: string, sub: string, match: RegExp): Promise<{ mod: string; file: string }[]> {
  const out: { mod: string; file: string }[] = []
  const entries = await readdir(mods, { withFileTypes: true }).catch(() => [])
  for (const e of entries.filter((d) => d.isDirectory()).slice(0, 3000)) {
    const dir = join(mods, e.name, ...sub.split('/').filter(Boolean))
    const files = await readdir(dir).catch(() => [] as string[])
    for (const f of files) if (match.test(f)) out.push({ mod: e.name, file: join(dir, f) })
  }
  return out
}

const noMods = (id: 'addresslib' | 'runtime' | 'skyui'): CheckResult => ({
  id, label: label[id], status: 'skipped',
  detail: 'Set the MO2 mods directory (the MO2 row) so Inkwell can look for it among your mods. Nothing is checked inside the game Data folder.'
})
const modList = (hits: { mod: string }[]): string => [...new Set(hits.map((h) => `"${h.mod}"`))].join(', ')

export async function checkSkse(ctx: DoctorContext, skyrimPath: string | undefined): Promise<CheckResult> {
  if (!skyrimPath) return { id: 'skse', label: label.skse, status: 'skipped', detail: 'Needs the Skyrim install first.' }
  const loader = join(skyrimPath, 'skse64_loader.exe')
  return existsSync(loader)
    ? { id: 'skse', label: label.skse, status: 'pass', detail: `skse64_loader.exe is in ${skyrimPath}. Start the game through it (from MO2: the SKSE entry).` }
    : { id: 'skse', label: label.skse, status: 'fail', detail: `skse64_loader.exe is not in ${skyrimPath}. Inkwell Runtime is an SKSE plugin, so custom menus never open without SKSE64 (HUD widgets need SKSE too, through SkyUI).`, fix: { label: 'Get SKSE64', action: { kind: 'open', url: 'https://skse.silverlock.org/' } } }
}

const VERSIONLIB = /^versionlib-.*\.bin$/i

export async function checkAddressLibrary(ctx: DoctorContext, skyrimPath: string | undefined): Promise<CheckResult> {
  const mods = ctx.settings.mo2ModsDir
  if (!mods && !skyrimPath) return noMods('addresslib')
  const hits = [
    ...(mods ? await modFiles(mods, 'SKSE/Plugins', VERSIONLIB) : []),
    ...(skyrimPath ? (await readdir(join(skyrimPath, 'Data', 'SKSE', 'Plugins')).catch(() => [] as string[])).filter((f) => VERSIONLIB.test(f)).map((f) => ({ mod: 'the game Data folder', file: f })) : [])
  ]
  return hits.length
    ? { id: 'addresslib', label: label.addresslib, status: 'pass', detail: `Address Library data (${hits.length} file${hits.length === 1 ? '' : 's'}) found in ${modList(hits)}. It must match your game version; if the game logs address library errors, install the build for your version.` }
    : { id: 'addresslib', label: label.addresslib, status: 'warn', detail: 'No Address Library for SKSE Plugins found (no versionlib-*.bin in any mod). Inkwell Runtime needs it; without it the plugin does not load and menus never open.', fix: { label: 'Get Address Library', action: { kind: 'open', url: 'https://www.nexusmods.com/skyrimspecialedition/mods/32444' } } }
}

export async function checkRuntime(ctx: DoctorContext): Promise<CheckResult> {
  const mods = ctx.settings.mo2ModsDir
  if (!mods) return noMods('runtime')
  const hits = await modFiles(mods, 'SKSE/Plugins', /^Inkwell\.dll$/i)
  if (!hits.length)
    return { id: 'runtime', label: label.runtime, status: 'warn', detail: 'Inkwell.dll was not found in any MO2 mod (SKSE/Plugins/Inkwell.dll). Custom menus only open with the Inkwell Runtime; HUD widgets do not need it. The portable zip has it in Inkwell-Runtime (SKSE/Plugins): put it in an MO2 mod (Inkwell never writes it for you).' }
  const v = await exeVersion(hits[0]!.file, ctx.exec)
  const many = hits.length > 1 ? ` ${hits.length} copies exist (${modList(hits)}); the one in the mod with the higher MO2 priority loads.` : ''
  return { id: 'runtime', label: label.runtime, status: 'pass', detail: `Inkwell.dll${v ? ` ${v}` : ''} found in ${modList(hits.slice(0, 1))}. A menu mod says which runtime it needs (the deploy dialog, and the in-game message when it is too old).${many}` }
}

export async function checkSkyUi(ctx: DoctorContext): Promise<CheckResult> {
  const mods = ctx.settings.mo2ModsDir
  if (!mods) return noMods('skyui')
  const hits = await modFiles(mods, '', /^SkyUI_SE\.esp$/i)
  return hits.length
    ? { id: 'skyui', label: label.skyui, status: 'pass', detail: `SkyUI found in ${modList(hits)} (the version is not read: Inkwell was tested with SkyUI 5.2 and 6.11). Custom menus do not need it; HUD widgets do. A menu replacement of the Inventory should be built for SkyUI 5.2 if your players may use it (Target dialog, Built for).` }
    : { id: 'skyui', label: label.skyui, status: 'skipped', detail: 'SkyUI was not found in your MO2 mods. That is fine for custom menus and menu replacements; HUD widgets need SkyUI.' }
}
