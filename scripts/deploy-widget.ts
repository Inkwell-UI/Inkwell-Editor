// Copies build/widget-test/ into the MO2 mod folder "Inkwell Widget Test" (never the game's Data folder). Run yarn compile:widget first.
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { writeModFolder } from '../src/main/widget/compileWidget'

const src = resolve(__dirname, '../build/widget-test')
const dest = resolve(process.env['INKWELL_WIDGET_DEPLOY'] ?? 'C:\\Modding\\MO2\\mods\\Inkwell Widget Test')
if (/[\\/]data([\\/]|$)/i.test(dest) && /skyrim/i.test(dest)) throw new Error(`Refusing to write into a game Data folder: ${dest}`)
if (!existsSync(src)) throw new Error(`${src} does not exist; run yarn compile:widget first.`)

async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) out.push(...(e.isDirectory() ? await walk(join(dir, e.name)) : [join(dir, e.name)]))
  return out
}

async function main(): Promise<void> {
  const files: Record<string, Buffer> = {}
  for (const f of await walk(src)) files[relative(src, f).split('\\').join('/')] = await readFile(f)
  await writeModFolder(dest, files)
  for (const p of Object.keys(files)) console.log(`${dest}\\${p.split('/').join('\\')}`)
}
void main()
