// yarn compile:system-injector -> ../Inkwell-Runtime/Interface/Inkwell/SystemMenuInjector.swf (ships beside Inkwell.dll). Needs java + FFDec + the wrapper jar (yarn build:wrapper).
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createFfdecWrapper } from '../src/main/build/ffdecWrapper'
import { doAction, endTag, showFrame, writeSwf } from '../src/main/swf/tags'

const root = resolve(__dirname, '..')
const runtime = resolve(root, '../Inkwell-Runtime')

async function main(): Promise<void> {
  const work = resolve(root, 'build/system-injector')
  const out = resolve(runtime, 'Interface/Inkwell/SystemMenuInjector.swf')
  await mkdir(resolve(work, 'as2/frame_1'), { recursive: true })
  await mkdir(dirname(out), { recursive: true })
  await writeFile(resolve(work, 'as2/frame_1/DoAction.as'), await readFile(resolve(runtime, 'flash/SystemMenuInjector.as'), 'utf8'))
  await writeFile(resolve(work, 'base.swf'), writeSwf({ widthPx: 1, heightPx: 1, tags: [doAction(), showFrame(), endTag()] }))
  const ffdec = createFfdecWrapper({
    javaPath: process.env['INKWELL_JAVA'] ?? 'java',
    ffdecDir: process.env['INKWELL_FFDEC'] ?? 'C:\Program Files (x86)\FFDec',
    jarPath: resolve(root, 'tools/ffdec-wrapper/build/ffdec-wrapper.jar')
  })
  try {
    const r = await ffdec.build({ base: resolve(work, 'base.swf'), scripts: resolve(work, 'as2'), out })
    if (!r.ok) throw new Error(`FFDec build failed: ${r.error ?? 'unknown error'}`)
    console.log(`wrote ${out}`)
  } finally {
    ffdec.stop()
  }
}
main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})
