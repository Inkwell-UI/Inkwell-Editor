// Copies the core pack (manifest, nodes, templates) from the sibling repo into resources/packs/core, and the MathUtils and Inventory packs into tests/fixtures/packs. Run after changing a sibling pack.
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
// The math and Inventory nodes are packs of their own; the tests load them from tests/fixtures/packs (committed copies, like core).
for (const [repo, id] of [['Inkwell-MathUtils-Pack', 'mathutils'], ['Inkwell-Inventory-Pack', 'inventory']]) {
  const from = resolve(here, '..', '..', repo)
  if (!existsSync(join(from, 'manifest.json'))) throw new Error(`${repo} not found at ${from}`)
  const to = resolve(here, '..', 'tests', 'fixtures', 'packs', id)
  rmSync(to, { recursive: true, force: true })
  mkdirSync(to, { recursive: true })
  for (const f of ['manifest.json', 'nodes', 'templates']) cpSync(join(from, f), join(to, f), { recursive: true })
  console.log(`${id} pack copied to ${to}`)
}
// The optional utility packs ship with the editor (resources/packs/bundled/<id>), loaded after core unless the project locked its own copy of the id.
const bundled = resolve(here, '..', 'resources', 'packs', 'bundled')
rmSync(bundled, { recursive: true, force: true })
for (const [repo, id] of [['Inkwell-MathUtils-Pack', 'mathutils'], ['Inkwell-StringUtils-Pack', 'stringutils'], ['Inkwell-ObjectUtils-Pack', 'objectutils'], ['Inkwell-DateTimeUtils-Pack', 'datetimeutils'], ['Inkwell-ColorUtils-Pack', 'colorutils']]) {
  const from = resolve(here, '..', '..', repo)
  if (!existsSync(join(from, 'manifest.json'))) throw new Error(`${repo} not found at ${from}`)
  const to = join(bundled, id)
  mkdirSync(to, { recursive: true })
  for (const f of ['manifest.json', 'nodes', 'templates']) cpSync(join(from, f), join(to, f), { recursive: true })
  console.log(`${id} bundled to ${to}`)
}
