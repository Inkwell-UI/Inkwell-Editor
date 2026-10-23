import type { SwfDoc } from '../../shared/projectState'

export type OrphanEntry =
  /** A whole SWF whose Figma frame is gone (design spec: kept, never built, never deleted). */
  | { kind: 'swf'; swfId: string; swfName: string }
  /** An overlay entry whose node id is no longer in the SWF's IR (the layer was deleted, or an instance was detached/duplicated). */
  | { kind: 'overlay'; swfId: string; swfName: string; nodeId: string; held: string[] }

/** Human-neutral keys held by an overlay entry (`role`, `instanceName`, `scripts`, ...). Unknown keys are listed too: that data must not be lost. */
export const heldKeys = (entry: Record<string, unknown>): string[] => Object.keys(entry).sort()

/**
 * Orphans of the project. Pure: for every SWF, orphaned SWFs first as one entry, then overlay entries whose node id does not exist
 * in that SWF's IR. An orphaned SWF's overlay entries are not listed one by one (the SWF entry covers them). Empty overlay entries hold nothing and are skipped.
 */
export function computeOrphans(swfs: readonly Pick<SwfDoc, 'id' | 'name' | 'orphaned' | 'ir' | 'overlay'>[]): OrphanEntry[] {
  const out: OrphanEntry[] = []
  for (const s of swfs) {
    if (s.orphaned) {
      out.push({ kind: 'swf', swfId: s.id, swfName: s.name })
      continue
    }
    for (const [nodeId, entry] of Object.entries(s.overlay.nodes ?? {})) {
      if (s.ir.nodes[nodeId] || !entry || typeof entry !== 'object') continue
      const held = heldKeys(entry)
      if (held.length) out.push({ kind: 'overlay', swfId: s.id, swfName: s.name, nodeId, held })
    }
  }
  return out
}
