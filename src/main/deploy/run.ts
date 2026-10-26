import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { imageHashes, type Graph, type MenuSettings, type Swf } from '@inkwell-ui/spec'
import { buildMenuDef, defaultMenuSettings, menuJsonPath, menuLint, modIniPath, modIniText, resolveMenuNames, type MenuSource } from '../../shared/menu'
import { stableStringify } from '../project'
import type { CodegenPacks } from '../codegen/packs'
import type { DeployFileInfo, DeployLintItem, DeployResult } from '../../shared/deploy'
import { createStageTimer } from '../../shared/timing'
import { ddsRel, type AssetStore, type ImageMode } from '../images/assets'
import { writeDds } from '../images/dds'
import { decodePng } from '../images/png'
import { unreachableNodes, UNREACHABLE_MESSAGE } from '../sync/syncServer'
import { isUnmodifiedVanilla } from '../vanilla/cache'
import { compileWidget, type WidgetOptions } from '../widget/compileWidget'
import { planDeploy, type DeployPlan, type SwfLike } from './plan'
import { readManifest, staleFiles, writeDeploy } from './write'

export interface DeploySwf extends SwfLike {
  /** Overlay instance names by node id (they feed the compiler). */
  instanceNames?: Record<string, string>
  /** The SWF's overlay entries by node id (widget placement override, settable texts). */
  overlay?: WidgetOptions['overlay']
  ir: Swf
  /** customMenu: the latest build of this SWF in this session (deploy ships that file, so its lint is the SWF's lint). Absent = not built yet. */
  build?: { state: 'compiling' | 'failed' | 'done'; lint: DeployLintItem[] }
  /** Issues of the SWF's visual-scripting graphs (the one graph validation); errors block the export like compile lint. */
  graphLint?: DeployLintItem[]
  /** The SWF's graphs; a hudWidget compiles them into its widget class and Papyrus API (needs `DeployInput.packs`). */
  graphs?: Graph[]
  /** customMenu: the SWF's menu.json (absent = the defaults), and the error when the file exists but could not be read. */
  menu?: MenuSettings
  menuError?: string
}

export interface DeployInput {
  modId: string
  /** The project's display name: the header of the generated INI. Default: the mod id. */
  modName?: string
  swfs: DeploySwf[]
  root: string
  /** Game install folders known to the editor; their Data folder is never written. */
  gameDirs: string[]
  /** Only this SWF (name); omitted = every SWF of the project. */
  only?: string
  buildDir: string
  ffdec: WidgetOptions['ffdec']
  papyrusExe?: string
  stubsDir?: string
  /** Hashes of the vanilla SWF cache; empty when it is not built. */
  vanillaHashes: ReadonlySet<string>
  /** Project image mode; 'dds' also writes textures/Inkwell/<modId>/<hash>.dds for every image the deployed SWFs use (docs/images.md). */
  imageMode?: ImageMode
  /** The project's image assets (widget compiles read pixels; dds mode reads the PNGs). */
  assets?: Pick<AssetStore, 'get' | 'png'>
  /** Node definitions and templates for compiling graphs; without them graphs are not compiled. */
  packs?: CodegenPacks
}

/** Everything is compiled and checked before the first byte is written. */
export interface Prepared {
  plan: DeployPlan
  files: Map<string, { data: Buffer; swf: string; createOnly?: boolean }>
  info: DeployFileInfo[]
  removed: string[]
  /** Deploy-level notices from the plan (no SWF lint; never promoted by Strict Mode). */
  lint: DeployLintItem[]
  /** Lint of the deployed SWFs (compile lint, unreachable layers, missing builds): the input of the export gate. */
  issues: DeployLintItem[]
  scope: Set<string>
  stages: Record<string, number>
}

export type PrepareOutcome = { ok: true; prepared: Prepared } | { ok: false; error: string; lint?: DeployLintItem[] }

const notReady = (s: DeploySwf, buildDir: string): string =>
  !s.build ? `"${s.name}" has not been built since the project was opened. Run Build All first.`
    : s.build.state === 'compiling' ? `"${s.name}" is still compiling. Wait for the build, then deploy.`
      : s.build.state === 'failed' ? `"${s.name}": the last build failed. Fix it and run Build All.`
        : `"${s.name}" has no build yet (${join(buildDir, `${s.name}.swf`)}). Run Build All first.`

export async function prepareDeploy(i: DeployInput): Promise<PrepareOutcome> {
  const plan = planDeploy({ modId: i.modId, swfs: i.swfs, root: i.root, gameDirs: i.gameDirs, hasPapyrus: !!i.papyrusExe, ...(i.only ? { only: i.only } : {}) })
  if (plan.errors.length) return { ok: false, error: plan.errors.join(' '), lint: plan.lint }
  const timer = createStageTimer()
  const lint: DeployLintItem[] = [...plan.lint]
  const issues: DeployLintItem[] = []
  const files = new Map<string, { data: Buffer; swf: string; createOnly?: boolean }>()
  const allowed = new Set(plan.files.map((f) => f.rel))
  // custom menus (S9): the project's menus decide the slot lint and the INI; a scoped deploy still lints the whole project's count
  const menuSources: MenuSource[] = i.swfs.filter((x) => !x.orphaned && x.kind === 'customMenu').map((x) => ({ swf: x.name, settings: x.menu ?? defaultMenuSettings() }))
  const menuRows = menuLint(i.modId, menuSources)
  if (i.swfs.some((x) => x.kind === 'customMenu' && !x.orphaned && (!i.only || x.name === i.only))) issues.push(...menuRows.filter((r) => !r.swf)) // project-level rows (menu-limit)
  timer.start('compile')
  try {
    for (const s of i.swfs.filter((x) => !x.orphaned && (!i.only || x.name === i.only))) {
      if (s.kind !== 'hudWidget' && s.kind !== 'customMenu') continue // menu replacements are skipped by the plan (warning)
      const first = issues.length
      const fail = (code: string, message: string): void => void issues.push({ severity: 'error', code, message, swf: s.name })
      for (const id of unreachableNodes(s.ir)) issues.push({ severity: 'warning', code: 'unreachable-node', message: `"${s.ir.nodes[id]!.name}": ${UNREACHABLE_MESSAGE}.`, swf: s.name, nodeId: id, layerName: s.ir.nodes[id]!.name })
      if (s.graphLint) issues.push(...s.graphLint.map((l) => ({ ...l, swf: s.name })))
      if (s.kind === 'hudWidget') {
        const r = await compileWidget(s.ir, {
          modId: i.modId, widgetName: plan.widgets[s.name]!, ...(s.instanceNames ? { instanceNames: s.instanceNames } : {}), ...(s.overlay ? { overlay: s.overlay } : {}), ...(i.packs && s.graphs?.length ? { graphs: { graphs: s.graphs, packs: i.packs } } : {}), buildDir: join(i.buildDir, 'deploy', s.name), ffdec: i.ffdec,
          ...(i.imageMode ? { imageMode: i.imageMode } : {}), ...(i.assets ? { images: (h: string) => i.assets!.get(h) } : {}),
          ...(i.papyrusExe ? { papyrusExe: i.papyrusExe } : {}), ...(i.stubsDir ? { stubsDir: i.stubsDir } : {})
        })
        for (const l of r.lint)
          if (l.code !== 'papyrus-skipped') issues.push({ severity: l.severity, code: l.code, message: l.message, swf: s.name, nodeId: l.nodeId, ...(l.nodeName ? { layerName: l.nodeName } : {}) })
        if (issues.slice(first).some((l) => l.severity === 'error')) continue // blocked by the gate: nothing of this SWF is deployed
        for (const [rel, data] of Object.entries(r.files)) {
          if (!allowed.has(rel)) continue // compile output the plan does not list (no compiler: scripts and plugin) is not deployed
          files.set(rel, { data, swf: s.name })
        }
      } else if (s.kind === 'customMenu') {
        const data = s.build?.state === 'done' ? await readFile(join(i.buildDir, `${s.name}.swf`)).catch(() => undefined) : undefined
        if (!data) {
          fail('build-not-ready', notReady(s, i.buildDir))
          continue
        }
        issues.push(...s.build!.lint.map((l) => ({ ...l, swf: s.name })))
        issues.push(...menuRows.filter((r) => r.swf === s.name))
        if (s.menuError) fail('menu-file-invalid', `${s.menuError}. Fix or delete swfs/${s.name}/menu.json.`)
        if (issues.slice(first).some((l) => l.severity === 'error')) continue
        const src: MenuSource = { swf: s.name, settings: s.menu ?? defaultMenuSettings() }
        files.set(resolveMenuNames(i.modId, src).swf, { data, swf: s.name })
        files.set(menuJsonPath(resolveMenuNames(i.modId, src).name), { data: Buffer.from(stableStringify(buildMenuDef(i.modId, src).def)), swf: s.name })
        // one commented default INI per mod (all its menus); created if absent, never overwritten or retired (docs/menus.md)
        const ini = modIniPath(i.modId)
        if (allowed.has(ini) && !files.has(ini)) files.set(ini, { data: Buffer.from(modIniText(i.modName ?? i.modId, i.modId, menuSources)), swf: s.name, createOnly: true })
      }
      // dds mode: the game SWF loads img://textures/Inkwell/<modId>/<hash>.dds, so ship one DDS per image (embedded mode adds nothing)
      if (i.imageMode === 'dds')
        for (const h of new Set(Object.values(s.ir.nodes).flatMap(imageHashes))) {
          const rel = ddsRel(i.modId, h) // throws on a hash that is not plain hex: it becomes a path
          if (files.has(rel)) continue
          const png = i.assets?.png(h)
          if (!png) return { ok: false, error: `"${s.name}" uses image ${h.slice(0, 8)}, which is not in the project's assets. Sync it from Figma first.`, lint }
          files.set(rel, { data: writeDds(decodePng(png)), swf: s.name })
        }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), lint }
  } finally {
    timer.end('compile')
  }
  const missing = plan.files.filter((f) => !files.has(f.rel))
  if (missing.length && i.papyrusExe && !issues.some((l) => l.severity === 'error')) return { ok: false, error: `The build did not produce: ${missing.map((m) => m.rel).join(', ')}.`, lint }
  timer.start('vanilla')
  const vanilla = [...files].filter(([rel, f]) => rel.toLowerCase().endsWith('.swf') && isUnmodifiedVanilla(f.data, i.vanillaHashes)).map(([rel]) => rel)
  timer.end('vanilla')
  if (vanilla.length) return { ok: false, error: `Refusing to deploy unmodified vanilla files (Bethesda's SWFs are never exported): ${vanilla.join(', ')}.`, lint }
  const scope = new Set(i.swfs.filter((s) => !s.orphaned && (!i.only || s.name === i.only)).map((s) => s.name))
  const removed = staleFiles(await readManifest(i.root), files.keys(), i.only ? scope : undefined)
  const t = timer.finishBuild()
  return {
    ok: true,
    prepared: { plan, files, info: [...files].map(([rel, f]) => ({ rel, size: f.data.length, swf: f.swf, ...(f.createOnly ? { keepExisting: true } : {}) })), removed, lint, issues, scope, stages: t.stages }
  }
}

/** Writes the prepared files (atomic per file), retires stale ones, writes the manifest. */
export async function commitDeploy(i: Pick<DeployInput, 'root' | 'modId' | 'only'>, p: Prepared): Promise<DeployResult> {
  const t0 = performance.now()
  try {
    const o = await writeDeploy({ root: i.root, modId: i.modId, files: p.files, ...(i.only ? { scope: p.scope } : {}) })
    const write = performance.now() - t0
    const stages = { ...p.stages, write }
    return {
      ok: true, root: i.root, written: o.written.length, unchanged: o.unchanged.length, removed: o.removed, kept: o.kept, preserved: o.preserved,
      timing: { stages, total: Object.values(stages).reduce((a, b) => a + b, 0) }
    }
  } catch (e) {
    return { ok: false, root: i.root, error: e instanceof Error ? e.message : String(e) }
  }
}
