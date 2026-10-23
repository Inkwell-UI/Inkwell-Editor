import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { CheckResult, ResolvedSettings } from '../../shared/doctor'
import { FFDEC_PINNED } from '../../shared/ffdec'
import { compilePapyrus } from '../widget/papyrusCompiler'
import { isInside, vanillaCacheStatus, vanillaCacheRoot } from '../vanilla/cache'
import { exeVersion, findSkyrim, run, runtimeLabel, type Run } from './skyrim'
import { readZipEntry } from './zip'

export interface DoctorContext {
  settings: ResolvedSettings
  appPath: string
  userData: string
  projectDir?: string
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
  figma: 'Figma plugin'
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
  const r = await compilePapyrus({ papyrusExe: exe, scripts: [{ name: 'InkwellDoctorProbe', source: PROBE }], workDir: join(ctx.userData, 'doctor', 'papyrus'), stubsDir: stubsPath(ctx.appPath) })
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
  const ver = await exeVersion(join(first.path, 'SkyrimSE.exe'), ctx.exec)
  const rt = ver ? runtimeLabel(ver) : undefined
  const bsa = join(first.path, 'Data', 'Skyrim - Interface.bsa')
  const others = found.length > 1 ? ` Also found: ${found.slice(1).map((f) => `${f.path} (${f.source})`).join('; ')}.` : ''
  const head = `${first.path} (${first.source}); SkyrimSE.exe ${ver ?? 'version unreadable'}${rt ? `, runtime ${rt.label}` : ''}.${others}`
  if (!existsSync(bsa)) return { id: 'skyrim', label: label.skyrim, status: 'fail', detail: `${head} Data\\Skyrim - Interface.bsa is missing; verify the game files in Steam/GOG.`, fix: manual }
  out.bsa = bsa
  return { id: 'skyrim', label: label.skyrim, status: rt?.known ? 'pass' : 'warn', detail: `${head} Skyrim - Interface.bsa is present.${rt && !rt.known ? ' Inkwell has not been checked against this runtime.' : ''}`, extra: [manual] }
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
  return ctx.settings.figmaManifest ?? resolve(ctx.appPath, '..', 'Inkwell-Figma', 'plugin', 'manifest.json')
}

export async function checkFigma(ctx: DoctorContext): Promise<CheckResult> {
  const p = figmaManifestPath(ctx)
  const ok = existsSync(p) && statSync(p).isFile()
  const link = ctx.pluginConnections > 0 ? `A plugin is connected now (${ctx.pluginConnections}).` : 'No plugin is connected right now: in Figma Desktop run Plugins > Development > Inkwell and enter the session token.'
  const copy = { label: 'Copy manifest path', action: { kind: 'copy', text: p } } as const
  const browse = { label: 'Browse for manifest.json', action: { kind: 'browse', setting: 'figmaManifest', folder: false } } as const
  if (!ok) return { id: 'figma', label: label.figma, status: 'warn', detail: `Plugin manifest not found at ${p}. Check out the Inkwell-Figma repository next to the editor or choose the manifest. ${link}`, fix: browse, extra: [copy] }
  return { id: 'figma', label: label.figma, status: ctx.pluginConnections > 0 ? 'pass' : 'warn', detail: `Manifest: ${p}. In Figma Desktop import it via Plugins > Development > Import plugin from manifest. ${link}`, fix: copy, extra: [browse] }
}

