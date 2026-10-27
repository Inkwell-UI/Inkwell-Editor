import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CONTRACT_LAYERS, checkContract, ContractLayer, mergeContract, type ContractLayerName, type MergedContract, type Swf } from '@inkwell-ui/spec'
import type { LintIssue } from '../swf/lint'

/** The contract layers the editor ships (`resources/contracts`, a copy of the Spec's `contracts/`: `yarn sync:contracts`). */
export const contractsDir = (appPath: string): string => join(appPath, 'resources/contracts')

/** Every `<dir>/<menu>/*.json`, parsed with the Spec schema. A file that does not parse throws: the shipped data is tested in the Spec. */
export async function loadContracts(dir: string): Promise<ContractLayer[]> {
  const menus = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const out: ContractLayer[] = []
  for (const m of menus.filter((d) => d.isDirectory()))
    for (const f of (await readdir(join(dir, m.name))).filter((x) => x.endsWith('.json')))
      out.push(ContractLayer.parse(JSON.parse(await readFile(join(dir, m.name, f), 'utf8'))))
  return out
}

/** Layers a menu replacement is built for (IR `target.layers`, spec 8; SPEC-CHANGES W5): engine first; absent = engine only. */
export const targetLayers = (target: Swf['target']): string[] => target.layers ?? ['engine']

/** What is wrong with `target.layers`, or undefined: known names only, no duplicates, `engine` first. Mod layers are not picked yet. */
export function layersProblem(layers: readonly string[]): string | undefined {
  const bad = layers.filter((l) => !(CONTRACT_LAYERS as readonly string[]).includes(l) || l === 'mod')
  if (bad.length) return `unknown layer ${bad.map((l) => `"${l}"`).join(', ')} (known: ${CONTRACT_LAYERS.filter((l) => l !== 'mod').join(', ')})`
  if (new Set(layers).size !== layers.length) return 'a layer is listed twice'
  if (layers[0] !== 'engine') return 'the list must start with "engine"'
  return undefined
}

/** The merged contract of a menu replacement, or undefined (another target, no or an unknown contract, bad layers). The codegen builds the glue from it. */
export function contractFor(ir: Swf, layers: readonly ContractLayer[]): MergedContract | undefined {
  const name = ir.target.contract
  if (ir.target.kind !== 'menuReplacement' || !name || layersProblem(targetLayers(ir.target))) return undefined
  const own = layers.filter((l) => l.menu === name)
  return own.some((l) => l.layer === 'engine') ? mergeContract(own, targetLayers(ir.target) as ContractLayerName[]) : undefined
}

/** AS2 type of a compiled layer (shapes are not addressable clips). */
const layerType = (type: string): string => (type === 'frame' || type === 'image' ? 'MovieClip' : type === 'text' ? 'TextField' : 'Shape')

/**
 * Contract findings of one menu replacement (errors, so they block export): `contract-none` (warning: no contract named), `contract-unknown`,
 * `contract-layers`, `contract-missing` and `contract-wrong-type`. `layerPaths` are the compiled clip paths (`root.a.b`); `glue` is what the generated
 * replacement glue defines (functions, members, globals: `Generated.contractProvided`).
 */
export function contractLint(ir: Swf, layerPaths: Readonly<Record<string, string>>, layers: readonly ContractLayer[], glue: Readonly<Record<string, string>> = {}): LintIssue[] {
  if (ir.target.kind !== 'menuReplacement') return []
  const name = ir.target.contract
  if (!name) return [{ severity: 'warning', code: 'contract-none', nodeId: ir.root, message: 'This menu replacement names no contract (target.contract in ir.json, e.g. "InventoryMenu"), so it is not checked against what the game needs.' }]
  const own = layers.filter((l) => l.menu === name)
  if (!own.some((l) => l.layer === 'engine')) return [{ severity: 'error', code: 'contract-unknown', nodeId: ir.root, message: `No contract "${name}" is known (known: ${[...new Set(layers.map((l) => l.menu))].join(', ') || 'none'}).` }]
  const bad = layersProblem(targetLayers(ir.target))
  if (bad) return [{ severity: 'error', code: 'contract-layers', nodeId: ir.root, message: `target.layers of this menu replacement: ${bad}.` }]
  const merged = mergeContract(own, targetLayers(ir.target) as ContractLayerName[])
  const provided: Record<string, string> = { ...glue }
  const byPath: Record<string, string> = {}
  for (const [id, p] of Object.entries(layerPaths)) {
    const n = ir.nodes[id]
    if (!n || !p.startsWith('root.')) continue
    const path = `_${p}`
    provided[path] = layerType(n.type)
    byPath[path] = id
  }
  return checkContract(merged, provided).map((x): LintIssue => {
    const e = x.entry
    const from = e.layer === 'engine' ? 'the game' : e.layer === 'skyui52' ? 'SkyUI 5.2' : e.layer === 'skyui6' ? 'SkyUI 6' : 'a mod'
    const nodeId = byPath[e.path!] ?? ir.root
    const why = e.required === 'fatal' ? 'the game crashes when the menu opens' : e.layer === 'engine' ? 'the menu opens, but part of it does not work' : `${from} reports the menu as incompatible or breaks part of it`
    return x.code === 'contract-wrong-type'
      ? { severity: 'error', code: x.code, nodeId, message: `${e.path} must be a ${e.type} for ${from} ("${name}" contract), but it compiles as a ${x.found}; otherwise ${why}.` }
      : { severity: 'error', code: x.code, nodeId, message: `${e.path} (${e.kind}${e.type ? `, ${e.type}` : ''}${e.value !== undefined ? ` = ${JSON.stringify(e.value)}` : ''}) is required by ${from} ("${name}" contract); without it ${why}.` }
  })
}
