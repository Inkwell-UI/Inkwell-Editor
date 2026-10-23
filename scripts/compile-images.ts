// yarn compile:images [--deploy]: the in-game image test (docs/images.md). Needs java, FFDec and the wrapper jar.
// -> build/image-test/ in mod-folder layout: Interface/InkwellImageTest.swf (embedded) and InkwellImageTestDds.swf (dds), the DDS textures, runtime menu JSON.
// -> build/image-test-project/: an editor project (dds mode) with the same sheet and its PNG assets, for the Ruffle preview.
// --deploy copies build/image-test/ into the MO2 mod "Inkwell Spikes" (INKWELL_IMAGE_DEPLOY overrides); never into a game Data folder.
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createFfdecWrapper } from '../src/main/build/ffdecWrapper'
import { isGameData } from '../src/main/deploy/plan'
import { ddsRel } from '../src/main/images/assets'
import { writeDds } from '../src/main/images/dds'
import { saveProject } from '../src/main/project'
import { compileSwf } from '../src/main/swf/compile'
import { writeModFolder } from '../src/main/widget/compileWidget'
import { buildImageSheet, IMAGES, MOD_ID, SHEETS } from './image-test-sheet'

const root = resolve(__dirname, '..')
const out = resolve(root, 'build/image-test')
const projectDir = resolve(root, 'build/image-test-project')
const images = (h: string) => Object.values(IMAGES).find((i) => i.hash === h)?.image

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
      const r = await compileSwf(buildImageSheet(s.id, s.mode), { modId: MOD_ID, imageMode: s.mode, images, buildDir: resolve(root, 'build/image-test-work'), outPath: join(out, 'Interface', `${s.menu}.swf`), ffdec })
      for (const l of r.lint) {
        if (l.severity === 'error') errors++
        console.log(`${s.menu}: ${l.severity === 'error' ? '!!! ERROR' : l.severity.padEnd(7)} ${l.code} [${l.nodeId}] ${l.message}`)
      }
      files[`Interface/${s.menu}.swf`] = readFileSync(r.swfPath)
      // the runtime spike's menu registry (Inkwell-Runtime spikes/runtime-menu): one JSON per menu, hotkey = DirectInput scan code
      files[`SKSE/Plugins/Inkwell/menus/inkwell_${s.id}.json`] = Buffer.from(JSON.stringify({ name: s.menu, swf: `Interface/${s.menu}.swf`, flags: { pausesGame: true, cursor: true, modal: true }, trigger: { hotkey: s.hotkey } }, null, 2) + '\n')
      console.log(`${s.menu} (${s.mode}, key ${s.key}): ${r.swfPath} ${files[`Interface/${s.menu}.swf`]!.length} bytes`)
    }
  } finally {
    ffdec.stop()
  }
  for (const i of Object.values(IMAGES)) files[ddsRel(MOD_ID, i.hash)] = writeDds(i.image)
  await writeModFolder(out, files)

  // editor project with the dds sheet (opens in the editor; the preview embeds the images and the badge notes it)
  const dds = SHEETS[1]
  await saveProject(projectDir, {
    meta: { name: 'Image Test', modId: MOD_ID, version: '0.1.0', imageMode: 'dds', deploy: { preset: 'folder', path: '' } },
    swfs: { [dds.id]: { ir: buildImageSheet(dds.id, dds.mode) as unknown as Record<string, unknown>, overlay: {} } }
  })
  await mkdir(join(projectDir, 'assets'), { recursive: true })
  for (const i of Object.values(IMAGES)) await writeFile(join(projectDir, 'assets', `${i.hash}.png`), i.png)
  console.log(`wrote ${out} and ${projectDir}`)

  if (process.argv.includes('--deploy')) {
    const dest = resolve(process.env['INKWELL_IMAGE_DEPLOY'] ?? 'C:\\Modding\\MO2\\mods\\Inkwell Spikes')
    if (isGameData(dest, [])) throw new Error(`Refusing to write into a game Data folder: ${dest}`)
    if (!existsSync(dest)) throw new Error(`${dest} does not exist (expected the MO2 mod folder "Inkwell Spikes").`)
    await writeModFolder(dest, files)
    for (const p of Object.keys(files)) console.log(`deployed ${join(dest, ...p.split('/'))}`)
  }
  if (errors) {
    console.error(`\n!!!!!! ${errors} LINT ERROR(S): do not trust the in-game test. !!!!!!`)
    process.exitCode = 1
  }
}
void main()
