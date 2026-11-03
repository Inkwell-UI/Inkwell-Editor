import { readFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'
import { join } from 'node:path'
import type { PreviewArtBlob } from '../../shared/preview'
import { vanillaCacheStatus } from '../vanilla/cache'
import { ART_FILES } from './promptArt'

/**
 * The game's own prompt art for the Ruffle preview: the three menu SWFs (`ART_FILES`) read from the user's vanilla cache (extracted from their own install; see vanilla/cache.ts).
 * They are handed to the preview window and nothing else: never written into a project, build or deploy. A cache that is not built, or a missing file, gives fewer or no files, and
 * the preview keeps the drawn glyphs.
 */
export async function readPreviewArt(cacheRoot: string): Promise<PreviewArtBlob[]> {
  const st = await vanillaCacheStatus({ cacheRoot }).catch(() => undefined)
  if (!st?.built || !st.dir) return []
  const out: PreviewArtBlob[] = []
  for (const name of ART_FILES) {
    const b = await readFile(join(st.dir, 'interface', `${name}.swf`)).catch(() => undefined)
    if (!b) continue
    const bytes = withoutImports(b)
    out.push({ name, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer })
  }
  return out
}

const IMPORT_ASSETS = 57
const IMPORT_ASSETS2 = 71

/**
 * The preview's copy of a game menu SWF without its import tags. The game's menus import their fonts from `gfxfontlib.swf`, which Ruffle cannot fetch, and the movie then never finishes loading.
 * Without the imports their text falls back to the preview fonts; the sprites are untouched. Works on `FWS` and `CWS` files and returns the bytes unchanged for anything else. Only this in-memory
 * copy changes: the cached file stays as extracted.
 */
export function withoutImports(swf: Buffer): Buffer {
  const sig = swf.toString('latin1', 0, 3)
  if ((sig !== 'FWS' && sig !== 'CWS') || swf.length < 8) return swf
  let body: Buffer
  try {
    body = sig === 'CWS' ? inflateSync(swf.subarray(8)) : swf.subarray(8)
  } catch {
    return swf
  }
  const nbits = body[0]! >> 3
  let at = Math.ceil((5 + 4 * nbits) / 8) + 4 // the frame rectangle, then frame rate and count
  const head = body.subarray(0, at)
  const kept: Buffer[] = [head]
  while (at + 2 <= body.length) {
    const h = body.readUInt16LE(at)
    const code = h >> 6
    let len = h & 0x3f
    let hdr = 2
    if (len === 0x3f) {
      if (at + 6 > body.length) return swf
      len = body.readUInt32LE(at + 2)
      hdr = 6
    }
    const end = at + hdr + len
    if (end > body.length) return swf
    if (code !== IMPORT_ASSETS && code !== IMPORT_ASSETS2) kept.push(body.subarray(at, end))
    at = end
  }
  const all = Buffer.concat(kept)
  const out = Buffer.alloc(8)
  out.write('FWS', 0, 'latin1')
  out[3] = swf[3]!
  out.writeUInt32LE(8 + all.length, 4)
  return Buffer.concat([out, all])
}
