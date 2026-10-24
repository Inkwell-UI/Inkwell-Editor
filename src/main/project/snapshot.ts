import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hashNode, imageHashes, PROTOCOL_VERSION, SPEC_VERSION, type Swf } from '@inkwell-ui/spec'
import { z } from 'zod'
import { writeAtomic } from '../deploy/write'
import { stableStringify } from './index'

/**
 * `figma/snapshot.json`: where the project's visuals came from. The visual IR itself stays in `swfs/<name>/ir.json` and the images in
 * `assets/<hash>.png` (builds read those, never this file); the snapshot records the provenance and a hash tree root per SWF, so an offline project
 * says what it was built from and an `ir.json` changed outside a sync is visible. Never holds the session token.
 */
export const SNAPSHOT_PATH = ['figma', 'snapshot.json'] as const

const SwfEntry = z.looseObject({
  /** The top-level Figma frame's node id (the sync protocol's swfId). */
  frameId: z.string(),
  /** The frame's name in Figma (the folder name is its sanitized form). */
  frameName: z.string(),
  /** `treeHash` of the IR: hashNode over every node's hashNode, the same per-node hashes the plugin's hashTree compares. */
  rootHash: z.string(),
  nodes: z.number().int(),
  /** Image hashes the SWF references (sorted). */
  assets: z.array(z.string())
})
const SnapshotContent = z.looseObject({
  schema: z.literal(1),
  specVersion: z.number().int(),
  protocolVersion: z.number().int(),
  /** From the plugin's last hello; absent until a plugin connected. */
  source: z.looseObject({ pluginVersion: z.string().optional(), fileKey: z.string().optional() }).optional(),
  /** By folder name under swfs/. */
  swfs: z.record(z.string(), SwfEntry),
  /** Referenced images that are not in assets/ yet (absent when none). */
  missingAssets: z.array(z.string()).optional()
})
export type SnapshotContent = z.infer<typeof SnapshotContent>
/** `updatedAt`: time of the last change of anything else (not of every save). */
export const FigmaSnapshot = SnapshotContent.extend({ updatedAt: z.string() })
export type FigmaSnapshot = z.infer<typeof FigmaSnapshot>
export type SnapshotSource = NonNullable<FigmaSnapshot['source']>

/** Hash tree root of one SWF (order-independent: hashNode sorts keys). */
export const treeHash = (ir: Pick<Swf, 'nodes'>): string => hashNode(Object.fromEntries(Object.entries(ir.nodes).map(([id, n]) => [id, hashNode(n)])))

/** The snapshot's content for `swfs` (folder name -> IR), without the time. */
export function snapshotContent(swfs: Record<string, Swf>, hasAsset: (hash: string) => boolean, source?: SnapshotSource): SnapshotContent {
  const entries: FigmaSnapshot['swfs'] = {}
  const missing = new Set<string>()
  for (const [name, ir] of Object.entries(swfs)) {
    const assets = [...new Set(Object.values(ir.nodes).flatMap(imageHashes))].sort()
    for (const h of assets) if (!hasAsset(h)) missing.add(h)
    entries[name] = { frameId: ir.id, frameName: ir.nodes[ir.root]?.name ?? ir.name, rootHash: treeHash(ir), nodes: Object.keys(ir.nodes).length, assets }
  }
  return {
    schema: 1, specVersion: SPEC_VERSION, protocolVersion: PROTOCOL_VERSION, swfs: entries,
    ...(source && Object.keys(source).length ? { source } : {}), ...(missing.size ? { missingAssets: [...missing].sort() } : {})
  }
}

/** The snapshot of a project, or why it could not be used (missing is not an error: older projects have none). */
export async function readSnapshot(dir: string): Promise<{ snapshot?: FigmaSnapshot; error?: string }> {
  const text = await readFile(join(dir, ...SNAPSHOT_PATH), 'utf8').catch(() => undefined)
  if (text === undefined) return {}
  try {
    const r = FigmaSnapshot.safeParse(JSON.parse(text))
    return r.success ? { snapshot: r.data } : { error: `figma/snapshot.json is not a valid snapshot: ${r.error.issues[0]?.message ?? ''}` }
  } catch (e) {
    return { error: `figma/snapshot.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/**
 * Writes the snapshot atomically when its content changed; the time is only that of a real change, so a rebuild or an unchanged sync causes no git
 * churn. Without a `source` (no plugin connected in this session) the previous one is kept. Returns the snapshot on disk.
 */
export async function writeSnapshot(dir: string, content: SnapshotContent, now = new Date()): Promise<{ snapshot: FigmaSnapshot; written: boolean }> {
  const prev = (await readSnapshot(dir)).snapshot
  const next = { ...content, ...(!content.source && prev?.source ? { source: prev.source } : {}) }
  if (prev) {
    const { updatedAt, ...rest } = prev
    if (stableStringify(rest) === stableStringify(next)) return { snapshot: prev, written: false }
  }
  const snapshot = { ...next, updatedAt: now.toISOString() }
  await writeAtomic(join(dir, ...SNAPSHOT_PATH), Buffer.from(stableStringify(snapshot)))
  return { snapshot, written: true }
}

/** SWFs whose ir.json no longer matches the snapshot (edited or merged outside a sync), or that only one of them has. */
export function staleSwfs(snapshot: FigmaSnapshot, swfs: Record<string, Pick<Swf, 'nodes'>>): string[] {
  const names = new Set([...Object.keys(snapshot.swfs), ...Object.keys(swfs)])
  return [...names].filter((n) => !swfs[n] || snapshot.swfs[n]?.rootHash !== treeHash(swfs[n]!)).sort()
}
