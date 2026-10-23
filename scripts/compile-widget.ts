// yarn compile:widget -> build/widget-test/ (a mod folder). Needs java + FFDec + the wrapper jar (yarn build:wrapper); INKWELL_PAPYRUS (russo papyrus.exe) for the .pex files.
import { resolve } from 'node:path'
import { Swf } from '@inkwell-ui/spec'
import { createFfdecWrapper } from '../src/main/build/ffdecWrapper'
import { loadProject } from '../src/main/project'
import { compileWidget, writeModFolder } from '../src/main/widget/compileWidget'
import { papyrusFromEnv } from '../src/main/widget/papyrusCompiler'

const root = resolve(__dirname, '..')

async function main(): Promise<void> {
  const project = await loadProject(resolve(root, 'samples/hud-widget'))
  const ir = Swf.parse(project.swfs['hud']!.ir)
  const papyrusExe = papyrusFromEnv() // fails loudly: a widget without .pex does not work in game
  const ffdec = createFfdecWrapper({
    javaPath: process.env['INKWELL_JAVA'] ?? 'java',
    ffdecDir: process.env['INKWELL_FFDEC'] ?? 'C:\\Program Files (x86)\\FFDec',
    jarPath: resolve(root, 'tools/ffdec-wrapper/build/ffdec-wrapper.jar')
  })
  try {
    const r = await compileWidget(ir, { modId: project.meta.modId, widgetName: 'Hud', buildDir: resolve(root, 'build/widget-work'), ffdec, papyrusExe })
    const out = resolve(root, 'build/widget-test')
    await writeModFolder(out, r.files)
    for (const l of r.lint) console.log(`${l.severity.padEnd(7)} ${l.code} [${l.nodeId}] ${l.message}`)
    for (const [p, b] of Object.entries(r.files)) console.log(`  ${p} (${b.length} bytes)`)
    const ms = Object.entries(r.timings.stages).map(([k, v]) => `${k} ${v.toFixed(0)} ms`).join(', ')
    console.log(`wrote ${out} (${ms}; total ${r.timings.total.toFixed(0)} ms)`)
    if (r.lint.some((l) => l.severity === 'error')) process.exitCode = 1
  } finally {
    ffdec.stop()
  }
}
main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})
