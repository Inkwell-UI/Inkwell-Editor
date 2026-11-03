import { readFile, stat } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' }
const MAX_BYTES = 20 * 1024 * 1024

/**
 * A preview background image by the path the user once picked. The renderer sends any string it likes (it also comes from stored
 * settings), so only absolute paths with an image extension and a sane size are read. Never throws.
 */
export async function readPreviewImage(path: unknown): Promise<{ ok: true; mime: string; bytes: Uint8Array } | { ok: false }> {
  const mime = typeof path === 'string' && isAbsolute(path) ? MIME[extname(path).toLowerCase()] : undefined
  if (!mime || typeof path !== 'string') return { ok: false }
  try {
    const s = await stat(path)
    if (!s.isFile() || s.size > MAX_BYTES) return { ok: false }
    return { ok: true, mime, bytes: new Uint8Array(await readFile(path)) }
  } catch {
    return { ok: false }
  }
}
