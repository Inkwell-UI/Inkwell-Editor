// yarn compile:ingame -> build/ingametest.swf + build/ingametest720.swf (regenerates samples/ingame-test first). Needs java, FFDec, the wrapper jar.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createFfdecWrapper } from '../src/main/build/ffdecWrapper'
import { compileSwf } from '../src/main/swf/compile'
import { buildSheet, VARIANTS } from './ingame-test-sheet'

const root = resolve(__dirname, '..')
const ms = (v: number): string => `${v.toFixed(0)} ms`

async function main(): Promise<void> {
  const ffdec = createFfdecWrapper({
    javaPath: process.env['INKWELL_JAVA'] ?? 'java',
    ffdecDir: process.env['INKWELL_FFDEC'] ?? 'C:\\Program Files (x86)\\FFDec',
    jarPath: resolve(root, 'tools/ffdec-wrapper/build/ffdec-wrapper.jar')
  })
  let errors = 0
  try {
    for (const v of VARIANTS) {
      const ir = buildSheet(v.id, v.name, v.width, v.height)
      const dir = resolve(root, 'samples/ingame-test/swfs', v.id)
      mkdirSync(dir, { recursive: true })
      writeFileSync(resolve(dir, 'ir.json'), JSON.stringify(ir, null, 2) + '\n')
      const r = await compileSwf(ir, { modId: 'IngameTest', buildDir: resolve(root, 'build/ingame'), outPath: resolve(root, `build/${v.id}.swf`), ffdec })
      for (const l of r.lint) {
        if (l.severity === 'error') errors++
        console.log(`${l.severity === 'error' ? '!!! ERROR' : l.severity.padEnd(7)} ${l.code} [${l.nodeId}] ${l.message}`)
      }
      const st = Object.entries(r.timings.stages).map(([k, t]) => `${k} ${ms(t)}`).join(', ')
      console.log(`wrote ${r.swfPath} (${readFileSync(r.swfPath).length} bytes; ${st}; total ${ms(r.timings.total)})`)
    }
  } finally {
    ffdec.stop()
  }
  if (errors) {
    console.error(`\n!!!!!! ${errors} LINT ERROR(S): the SWFs are missing nodes. Do not trust the in-game test. !!!!!!`)
    process.exitCode = 1
  }
}
void main()
