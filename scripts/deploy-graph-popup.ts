// yarn deploy:graph-popup -> deploys samples/hud-graph-popup through the editor's deploy code path (prepareDeploy, export gate, commitDeploy) into the MO2 mod folder from
// the project's deploy.path ("Inkwell Graph Test"; INKWELL_GRAPH_DEPLOY overrides). Never the game's Data folder. Needs Java, FFDec, the wrapper jar and INKWELL_PAPYRUS (russo papyrus.exe).
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { Swf } from '@inkwell-ui/spec'
import { createFfdecWrapper } from '../src/main/build/ffdecWrapper'
import { loadCodegenPacks } from '../src/main/codegen/packs'
import { commitDeploy, prepareDeploy, type DeployInput } from '../src/main/deploy/run'
import { exportGate } from '../src/main/lint/gate'
import { loadProject } from '../src/main/project'
import { papyrusFromEnv } from '../src/main/widget/papyrusCompiler'

const root = resolve(__dirname, '..')

async function main(): Promise<void> {
  const project = await loadProject(resolve(root, 'samples/hud-graph-popup'))
  const dest = resolve(process.env['INKWELL_GRAPH_DEPLOY'] ?? project.meta.deploy?.path ?? '')
  if (!/[\\/]mods[\\/][^\\/]+$/i.test(dest) || /[\\/]data([\\/]|$)/i.test(dest)) throw new Error(`Refusing to deploy to ${dest}: it must be one MO2 mod folder (...\\mods\\<name>), never a game Data folder.`)
  const s = project.swfs['hud']!
  const nodes = (s.overlay as { nodes?: Record<string, { instanceName?: string }> }).nodes ?? {}
  const ffdec = createFfdecWrapper({
    javaPath: process.env['INKWELL_JAVA'] ?? 'java',
    ffdecDir: process.env['INKWELL_FFDEC'] ?? 'C:\\Program Files (x86)\\FFDec',
    jarPath: resolve(root, 'tools/ffdec-wrapper/build/ffdec-wrapper.jar')
  })
  try {
    const input: DeployInput = {
      modId: project.meta.modId, root: dest, gameDirs: [], buildDir: mkdtempSync(resolve(tmpdir(), 'inkwell-deploy-')), ffdec, vanillaHashes: new Set(),
      packs: (await loadCodegenPacks([resolve(root, 'resources/packs/core')])).packs, papyrusExe: papyrusFromEnv(), stubsDir: resolve(root, 'resources/papyrus-stubs'),
      swfs: [{
        name: 'hud', orphaned: false, kind: 'hudWidget', ir: Swf.parse(s.ir), graphs: Object.values(s.graphs ?? {}), overlay: nodes as never,
        instanceNames: Object.fromEntries(Object.entries(nodes).flatMap(([id, o]) => (o.instanceName ? [[id, o.instanceName]] : [])))
      }]
    }
    const r = await prepareDeploy(input)
    if (!r.ok) throw new Error(r.error)
    for (const l of [...r.prepared.issues, ...r.prepared.lint]) console.log(`${l.severity.padEnd(7)} ${l.code} [${l.nodeId}] ${l.message}`)
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
