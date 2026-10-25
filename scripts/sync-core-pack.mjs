// Copies the core pack (manifest, nodes, templates) from the sibling repo into resources/packs/core. Run after changing ../Inkwell-Core-Pack.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '..', '..', 'Inkwell-Core-Pack')
const dst = resolve(here, '..', 'resources', 'packs', 'core')
if (!existsSync(join(src, 'manifest.json'))) throw new Error(`Core pack not found at ${src}`)
rmSync(dst, { recursive: true, force: true })
mkdirSync(dst, { recursive: true })
for (const f of ['manifest.json', 'nodes', 'templates']) cpSync(join(src, f), join(dst, f), { recursive: true })
console.log(`core pack copied to ${dst}`)
