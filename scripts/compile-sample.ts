// yarn compile:sample -> build/sample.swf. Needs java, the user's FFDec and the wrapper jar (yarn build:wrapper).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Swf } from '@inkwell-ui/spec'
import { createFfdecWrapper } from '../src/main/build/ffdecWrapper'
import { loadProject } from '../src/main/project'
import { compileSwf } from '../src/main/swf/compile'

const root = resolve(__dirname, '..')
const sample = resolve(root, 'samples/hud-minimal')
const name = process.argv[2] ?? 'hud'

async function main(): Promise<void> {
  const project = await loadProject(sample)
  const entry = project.swfs[name]
  if (!entry) throw new Error(`No swf "${name}" in ${sample}`)
  const ir = Swf.parse(entry.ir)
  // overlay instanceName per node id, if any
  const instanceNames: Record<string, string> = {}
  const overlayNodes = (entry.overlay['nodes'] ?? {}) as Record<string, { instanceName?: string }>
  for (const [id, o] of Object.entries(overlayNodes)) if (o.instanceName) instanceNames[id] = o.instanceName

  const ffdec = createFfdecWrapper({
    javaPath: process.env['INKWELL_JAVA'] ?? 'java',
    ffdecDir: process.env['INKWELL_FFDEC'] ?? 'C:\\Program Files (x86)\\FFDec',
    jarPath: resolve(root, 'tools/ffdec-wrapper/build/ffdec-wrapper.jar')
  })
  try {
    const r = await compileSwf(ir, {
      modId: project.meta.modId,
      instanceNames,
      buildDir: resolve(root, 'build/sample'),
      outPath: resolve(root, 'build/sample.swf'),
      ffdec
    })
    for (const l of r.lint) console.log(`${l.severity.padEnd(7)} ${l.code} [${l.nodeId}] ${l.message}`)
    const ms = Object.entries(r.timings.stages).map(([k, v]) => `${k} ${v.toFixed(0)} ms`).join(', ')
    console.log(`wrote ${r.swfPath} (${readFileSync(r.swfPath).length} bytes; ${ms}; total ${r.timings.total.toFixed(0)} ms)`)
  } finally {
    ffdec.stop()
  }
}
void main()
