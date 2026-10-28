// yarn deploy:inventory [--to <...\mods\name>]: the 0.5 Phase 5 test (TEST-IN-GAME-0.5.md, Phase 5 checks). samples/inventory-replacement (an Inventory menu replacement) through the editor's
// own deploy path (prepareDeploy, export gate, vanilla-hash check, commitDeploy) into C:\Modding\MO2\mods\Inkwell Inventory Replacement Test as Interface\inventorymenu.swf.
// No runtime DLL: a replacement does not use Inkwell Runtime. Never a game Data folder. Needs Java, FFDec and the wrapper jar.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { Swf } from '@inkwell-ui/spec'
import { createFfdecWrapper } from '../src/main/build/ffdecWrapper'
import { loadCodegenPacks } from '../src/main/codegen/packs'
import { commitDeploy, prepareDeploy, type DeployInput } from '../src/main/deploy/run'
import { contractFor, contractsDir, loadContracts } from '../src/main/lint/contract'
import { exportGate } from '../src/main/lint/gate'
import { loadProject } from '../src/main/project'
import { compileSwf } from '../src/main/swf/compile'
import { loadVanillaHashes, vanillaCacheRoot } from '../src/main/vanilla/cache'

const root = resolve(__dirname, '..')
const arg = (k: string): string | undefined => {
  const i = process.argv.indexOf(k)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const project = await loadProject(resolve(root, 'samples/inventory-replacement'))
  const dest = resolve(arg('--to') ?? process.env['INKWELL_INVENTORY_DEPLOY'] ?? project.meta.deploy?.path ?? '')
  if (!/[\\/]mods[\\/][^\\/]+$/i.test(dest) || /[\\/]data([\\/]|$)/i.test(dest)) throw new Error(`Refusing to deploy to ${dest}: it must be one MO2 mod folder (...\\mods\\<name>), never a game Data folder.`)
  const s = project.swfs['inventory']!
  const ir = Swf.parse(s.ir)
  const nodes = (s.overlay as { nodes?: Record<string, { instanceName?: string }> }).nodes ?? {}
  const layers = await loadContracts(contractsDir(root))
  const ffdec = createFfdecWrapper({ javaPath: process.env['INKWELL_JAVA'] ?? 'java', ffdecDir: process.env['INKWELL_FFDEC'] ?? 'C:\\Program Files (x86)\\FFDec', jarPath: resolve(root, 'tools/ffdec-wrapper/build/ffdec-wrapper.jar') })
  try {
    const { packs } = await loadCodegenPacks([resolve(root, 'resources/packs/core')])
    const buildDir = mkdtempSync(resolve(tmpdir(), 'inkwell-inventory-'))
    const graphs = Object.values(s.graphs ?? {})
    const built = await compileSwf(ir, {
      modId: project.meta.modId, buildDir, outPath: resolve(buildDir, 'inventory.swf'), ffdec, contract: contractFor(ir, layers)!, graphs: { graphs, packs },
      instanceNames: Object.fromEntries(Object.entries(nodes).flatMap(([id, o]) => (o.instanceName ? [[id, o.instanceName]] : [])))
    })
    const vanillaHashes = await loadVanillaHashes(vanillaCacheRoot(process.env['INKWELL_USER_DATA'] ?? resolve(process.env['APPDATA'] ?? '', 'inkwell-editor')))
    if (vanillaHashes.size === 0) console.warn('vanilla cache empty: the unmodified-vanilla check has nothing to compare against (the SWF is built from scratch anyway)')
    const input: DeployInput = {
      modId: project.meta.modId, modName: project.meta.name, root: dest, gameDirs: [], buildDir, ffdec, vanillaHashes, packs, contracts: layers,
      swfs: [{ name: 'inventory', orphaned: false, kind: 'menuReplacement', ir, graphs, build: { state: 'done', lint: built.lint } }]
    }
    const r = await prepareDeploy(input)
    if (!r.ok) throw new Error(r.error)
    for (const l of [...r.prepared.issues, ...r.prepared.lint]) console.log(`${l.severity.padEnd(7)} ${l.code} [${l.nodeId ?? ''}] ${l.message}`)
    const gate = exportGate(r.prepared.issues, false)
    if (!gate.ok) throw new Error(`Export gate blocked: ${gate.blocking.length} error(s).`)
    const c = await commitDeploy(input, r.prepared)
    if (!c.ok) throw new Error(`Deploy failed: ${JSON.stringify(c)}`)
    for (const f of r.prepared.info) console.log(`  ${dest}\\${f.rel.split('/').join('\\')}`)
    console.log(`deployed to ${dest}`)
  } finally {
    ffdec.stop()
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})
