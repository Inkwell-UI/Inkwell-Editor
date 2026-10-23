// Image assets of a project: `<project>/assets/<hash>.png`, keyed by the Figma image hash (memory only when no project is open).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AssetHash } from '@inkwell-ui/spec'
import { writeAtomic } from '../deploy/write'
import { decodePng, type Rgba } from './png'

export type ImageMode = 'embedded' | 'dds'

/** Hashes become file names: only Figma's 40 hex digits pass (the spec's AssetHash). */
export const isAssetHash = (h: string): boolean => AssetHash.safeParse(h).success

/** Mod-folder-relative DDS path; the game SWF loads it as `img://<this>`. Throws on a hash that is not a plain hex string. */
export function ddsRel(modId: string, hash: string): string {
  if (!isAssetHash(hash)) throw new Error(`"${hash}" is not an image hash.`)
  return `textures/Inkwell/${modId}/${hash}.dds`
}

export interface AssetStore {
  has(hash: string): boolean
  /** Checks the bytes decode as a PNG, then stores them (atomically on disk when there is a project). Throws on a bad hash or bad PNG. */
  put(hash: string, png: Buffer): Promise<void>
  /** Decoded pixels (cached), or undefined when the asset is missing or unreadable. */
  get(hash: string): Rgba | undefined
  /** The stored PNG bytes. */
  png(hash: string): Buffer | undefined
}

export function createAssetStore(projectDir?: string): AssetStore {
  const mem = new Map<string, Buffer>()
  const decoded = new Map<string, Rgba>() // shortcut: unbounded cache of decoded pixels; add an LRU if projects get many large images
  const file = (h: string): string | undefined => (projectDir && isAssetHash(h) ? join(projectDir, 'assets', `${h}.png`) : undefined)
  const png = (h: string): Buffer | undefined => {
    if (!isAssetHash(h)) return undefined
    const f = file(h)
    return mem.get(h) ?? (f && existsSync(f) ? readFileSync(f) : undefined)
  }
  return {
    has: (h) => {
      const f = file(h)
      return mem.has(h) || (!!f && existsSync(f))
    },
    png,
    async put(h, bytes) {
      if (!isAssetHash(h)) throw new Error(`"${h}" is not an image hash.`)
      const img = decodePng(bytes) // never store what the compiler cannot read
      const f = file(h)
      if (f) await writeAtomic(f, bytes)
      else mem.set(h, bytes)
      decoded.set(h, img)
    },
    get(h) {
      const c = decoded.get(h)
      if (c) return c
      const b = png(h)
      if (!b) return undefined
      try {
        const img = decodePng(b)
        decoded.set(h, img)
        return img
      } catch {
        return undefined
      }
    }
  }
}
