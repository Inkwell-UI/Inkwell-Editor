// yarn package:portable [--out <dir>]: the portable beta zip of the editor (milestone 0.5, owner decision 11: no installer, no auto update).
// Needs `yarn build` first (the script's yarn entry runs it) and the wrapper jar (`yarn build:wrapper`). Stages `<out>/Inkwell-<version>-win-x64/` and zips it with Windows' tar:
//   Inkwell.exe + the Electron runtime (the app's own copy of node_modules/electron/dist), resources/app (out, resources, docs, samples without build output, the runtime dependencies,
//   tools/ffdec-wrapper/build/ffdec-wrapper.jar), Inkwell-Figma-Plugin/ (manifest.json + dist), Inkwell-Runtime/ (Inkwell.dll and Inkwell_API.psc when built locally) and README-FIRST.txt.
// The zip is a build output: never committed (git-ignored). Nothing of Skyrim, SkyUI, FFDec, Java or a Papyrus compiler goes in. Run `Inkwell.exe` from the unzipped folder.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve, sep } from 'node:path'

const root = resolve(__dirname, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string; dependencies: Record<string, string> }
const arg = (k: string): string | undefined => {
  const i = process.argv.indexOf(k)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const outDir = resolve(arg('--out') ?? join(root, 'dist-portable'))
const name = `Inkwell-${pkg.version}-win-x64`
const stage = join(outDir, name)
const app = join(stage, 'resources', 'app')

const need = (p: string, why: string): string => {
  if (!existsSync(p)) throw new Error(`Missing ${p}: ${why}`)
  return p
}
const noBuild = (src: string) => (p: string): boolean => !/[\\/](build|node_modules|dist|packs-cache)$/.test(p) || p === src
/** The runtime dependency closure of the main process: `dependencies` only, recursively; the linked Spec is copied as a real folder (dist, schemas, contracts). */
function copyDeps(names: string[], from: string, to: string, seen = new Set<string>()): void {
  for (const n of names) {
    if (seen.has(n) || n === 'electron') continue
    seen.add(n)
    const dir = join(from, 'node_modules', ...n.split('/'))
    const real = realpathSync(need(dir, `dependency ${n} is not installed (yarn install)`))
    const dest = join(to, 'node_modules', ...n.split('/'))
    if (n === '@inkwell-ui/spec') for (const f of ['package.json', 'dist', 'schemas', 'contracts']) cpSync(join(real, f), join(dest, f), { recursive: true })
    else cpSync(real, dest, { recursive: true, filter: (p) => !/[\\/](\.cache|test|tests|__tests__)$/.test(p) })
    const sub = JSON.parse(readFileSync(join(real, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
    copyDeps(Object.keys(sub.dependencies ?? {}), n === '@inkwell-ui/spec' ? root : from, to, seen)
  }
}

console.log(`staging ${stage}`)
rmSync(stage, { recursive: true, force: true })
mkdirSync(app, { recursive: true })

// the Electron runtime, renamed
cpSync(need(join(root, 'node_modules/electron/dist'), 'run `node node_modules/electron/install.js`'), stage, { recursive: true, filter: (p) => !p.endsWith(`${sep}default_app.asar`) })
cpSync(join(stage, 'electron.exe'), join(stage, 'Inkwell.exe'))
rmSync(join(stage, 'electron.exe'))

// the app
writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'inkwell-editor', version: pkg.version, main: 'out/main/index.js' }, null, 2) + '\n')
cpSync(need(join(root, 'out'), 'run `yarn build`'), join(app, 'out'), { recursive: true })
need(join(root, 'out/main/index.js'), 'run `yarn build`')
for (const d of ['resources', 'docs']) cpSync(join(root, d), join(app, d), { recursive: true })
cpSync(join(root, 'samples'), join(app, 'samples'), { recursive: true, filter: noBuild(join(root, 'samples')) })
mkdirSync(join(app, 'tools/ffdec-wrapper/build'), { recursive: true })
cpSync(need(join(root, 'tools/ffdec-wrapper/build/ffdec-wrapper.jar'), 'run `yarn build:wrapper` (needs a JDK 9+)'), join(app, 'tools/ffdec-wrapper/build/ffdec-wrapper.jar'))
copyDeps(Object.keys(pkg.dependencies).filter((d) => ['@inkwell-ui/spec', 'lz4js', 'ws', 'zod'].includes(d)), root, app)

// the Figma plugin (built from the sibling checkout) and the runtime (built locally, optional)
const figma = resolve(root, '../Inkwell-Figma/plugin')
mkdirSync(join(stage, 'Inkwell-Figma-Plugin'), { recursive: true })
cpSync(need(join(figma, 'manifest.json'), 'the Inkwell-Figma checkout must sit next to this repo'), join(stage, 'Inkwell-Figma-Plugin/manifest.json'))
cpSync(need(join(figma, 'dist'), 'run `yarn build` in Inkwell-Figma'), join(stage, 'Inkwell-Figma-Plugin/dist'), { recursive: true })
const dll = resolve(root, '../Inkwell-Runtime/build/Release/Inkwell.dll')
if (existsSync(dll)) {
  mkdirSync(join(stage, 'Inkwell-Runtime/SKSE/Plugins'), { recursive: true })
  cpSync(dll, join(stage, 'Inkwell-Runtime/SKSE/Plugins/Inkwell.dll'))
  const psc = resolve(root, '../Inkwell-Runtime/papyrus/Source/Scripts/Inkwell_API.psc')
  if (existsSync(psc)) cpSync(psc, join(stage, 'Inkwell-Runtime/Source/Scripts/Inkwell_API.psc'), { recursive: true })
} else console.warn('warning: Inkwell-Runtime/build/Release/Inkwell.dll not found: the zip has no runtime (users must get it elsewhere)')

writeFileSync(join(stage, 'README-FIRST.txt'), [
  `Inkwell ${pkg.version} (beta, portable)`,
  '',
  '1. Unzip this folder anywhere you may write to, then start Inkwell.exe. There is no installer and no automatic update.',
  '2. Read resources\\app\\docs\\getting-started.md: from an empty Figma file to a menu in Skyrim, with every click.',
  '3. Figma: Plugins > Development > Import plugin from manifest... > Inkwell-Figma-Plugin\\manifest.json',
  '4. Skyrim: copy Inkwell-Runtime\\SKSE\\Plugins\\Inkwell.dll into an MO2 mod (Inkwell does not do it for you).',
  '5. Examples with a README each: resources\\app\\samples\\.',
  '',
  'Not included, install yourself: Java 8+, FFDec (JPEXS), a Papyrus compiler (optional), SKSE64, Address Library, MO2.',
  'Tested on Skyrim SE 1.7.104. Anniversary Edition was not tested separately; GOG is unverified.',
  ''
].join('\r\n'))

// zip with Windows' tar (bsdtar writes a plain zip with forward-slash names)
const zip = join(outDir, `${name}.zip`)
rmSync(zip, { force: true })
// Windows' own bsdtar by full path: a GNU tar earlier on PATH (Git Bash) reads `D:\x.zip` as host:file
const bsdtar = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe')
execFileSync(existsSync(bsdtar) ? bsdtar : 'tar', ['-a', '-c', '-f', zip, '-C', outDir, name], { stdio: 'inherit' })
const sha = createHash('sha256').update(readFileSync(zip)).digest('hex')
const count = (d: string): number => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(join(d, e.name)) : 1), 0)
console.log(`${zip}\n  ${(statSync(zip).size / 1048576).toFixed(1)} MB, ${count(stage)} files, sha256 ${sha}`)
