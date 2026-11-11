// yarn compile:slice [--deploy]: the in-game 9-slice / 3-slice test (docs/images.md, "Slice test"). Needs java, FFDec and the wrapper jar.
// -> build/slice-test/ in mod-folder layout: Interface/InkwellSliceTest.swf (embedded, Numpad 8), InkwellSliceTestDds.swf (dds, Numpad 9), the DDS textures, runtime menu JSON.
// --deploy copies it into the MO2 mod "Inkwell Slice Test" (INKWELL_SLICE_DEPLOY overrides); never into a game Data folder.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createFfdecWrapper } from '../src/main/build/ffdecWrapper'
import { isGameData } from '../src/main/deploy/plan'
import { ddsRel } from '../src/main/images/assets'
import { writeDds } from '../src/main/images/dds'
import { compileSwf } from '../src/main/swf/compile'
import { writeModFolder } from '../src/main/widget/compileWidget'
import { buildSliceSheet, extendSliceSheet, IMGS, MOD_ID, SHEETS } from './slice-test-sheet'

const root = resolve(__dirname, '..')
const out = resolve(root, 'build/slice-test')

async function main(): Promise<void> {
  const ffdec = createFfdecWrapper({
    javaPath: process.env['INKWELL_JAVA'] ?? 'java',
    ffdecDir: process.env['INKWELL_FFDEC'] ?? 'C:\\Program Files (x86)\\FFDec',
    jarPath: resolve(root, 'tools/ffdec-wrapper/build/ffdec-wrapper.jar')
  })
  const files: Record<string, Buffer> = {}
  let errors = 0
  try {
    for (const s of SHEETS) {
      const r = await compileSwf(buildSliceSheet(s.id, s.mode), { modId: MOD_ID, imageMode: s.mode, buildDir: resolve(root, 'build/slice-test-work'), outPath: join(out, 'Interface', `${s.menu}.swf`), ffdec, extend: extendSliceSheet(s.mode, (h) => `img://${ddsRel(MOD_ID, h)}`) })
      for (const l of r.lint) {
        if (l.severity === 'error') errors++
        console.log(`${s.menu}: ${l.severity === 'error' ? '!!! ERROR' : l.severity.padEnd(7)} ${l.code} [${l.nodeId}] ${l.message}`)
      }
      files[`Interface/${s.menu}.swf`] = readFileSync(r.swfPath)
      files[`SKSE/Plugins/Inkwell/menus/inkwell_${s.id}.json`] = Buffer.from(JSON.stringify({ specVersion: 8, name: s.menu, swf: `Interface/${s.menu}.swf`, minRuntime: '0.5.0', flags: { pausesGame: true, cursor: true, modal: true, closeOnEscape: true }, inputContext: 'menuMode', depth: 3, triggers: { hotkey: s.hotkey, papyrus: false } }, null, 2) + '\n')
      console.log(`${s.menu} (${s.mode}, key ${s.key}): ${r.swfPath} ${files[`Interface/${s.menu}.swf`]!.length} bytes`)
    }
  } finally {
    ffdec.stop()
  }
  for (const i of Object.values(IMGS)) files[ddsRel(MOD_ID, i.s.hash)] = writeDds(i.s.image)
  await writeModFolder(out, files)
  console.log(`wrote ${out}`)

  if (process.argv.includes('--deploy')) {
    const dest = resolve(process.env['INKWELL_SLICE_DEPLOY'] ?? 'C:\\Modding\\MO2\\mods\\Inkwell Slice Test')
    if (isGameData(dest, [])) throw new Error(`Refusing to write into a game Data folder: ${dest}`)
    if (!existsSync(dirname(dest))) throw new Error(`${dirname(dest)} does not exist (is INKWELL_SLICE_DEPLOY a path ending in \mods\<name>?).`)
    await writeModFolder(dest, files)
    for (const p of Object.keys(files)) console.log(`deployed ${join(dest, ...p.split('/'))}`)
  }
  if (errors) {
    console.error(`\n!!!!!! ${errors} LINT ERROR(S): do not trust the in-game test. !!!!!!`)
    process.exitCode = 1
  }
}
void main()
