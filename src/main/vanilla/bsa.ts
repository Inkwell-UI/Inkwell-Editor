import { closeSync, createReadStream, fstatSync, openSync, readSync } from 'node:fs'
import { createHash } from 'node:crypto'
import lz4 from 'lz4js'

// The only place that knows the BSA format (Skyrim SE, version 105; entries optionally LZ4 frames). Promoted from the 0.0 spike.

export interface BsaEntry {
  /** Folder with forward slashes, as stored (lower case in the vanilla archives). */
  folder: string
  name: string
  size: number
  offset: number
  compressed: boolean
}
export interface Bsa {
  path: string
  version: number
  embedNames: boolean
  entries: BsaEntry[]
}

function read(fd: number, pos: number, len: number): Buffer {
  const b = Buffer.alloc(len)
  if (readSync(fd, b, 0, len, pos) !== len) throw new Error('BSA: short read (truncated archive?)')
  return b
}

/** Reads the header, folder records and file records (not the file data). */
export function openBsa(path: string): Bsa {
  const fd = openSync(path, 'r')
  try {
    const h = read(fd, 0, 36)
    if (h.toString('latin1', 0, 4) !== 'BSA\0') throw new Error('Not a BSA archive')
    const version = h.readUInt32LE(4)
    if (version !== 105) throw new Error(`Unsupported BSA version ${version} (only Skyrim SE, 105)`)
    const flags = h.readUInt32LE(12)
    const folderCount = h.readUInt32LE(16)
    const fileCount = h.readUInt32LE(20)
    const fileNamesLen = h.readUInt32LE(28)
    const defaultCompressed = !!(flags & 0x4)
    const embedNames = !!(flags & 0x100)
    const FREC = 24 // v105 folder record: hash u64, count u32, pad u32, offset u64 (v104 has 16 bytes)
    const folders = read(fd, h.readUInt32LE(8), folderCount * FREC)
    const blockStart = 36 + folderCount * FREC
    const size = fstatSync(fd).size
    // folder offsets include the file-name block length; the first folder's block starts right after the folder records
    if (folderCount > 0 && Number(folders.readBigUInt64LE(16)) - fileNamesLen !== blockStart) throw new Error('BSA: unexpected layout')
    // shortcut: reads up to 64 MB after the folder records in one go (the vanilla Interface archive needs far less); upgrade to a size-computed read if a larger archive appears
    const blk = read(fd, blockStart, Math.min(size - blockStart, 64 * 1024 * 1024))
    const recs: { folder: string; items: { size: number; offset: number }[] }[] = []
    let p = 0
    for (let i = 0; i < folderCount; i++) {
      const count = folders.readUInt32LE(i * FREC + 8)
      const len = blk[p++]!
      const folder = blk.toString('latin1', p, p + len - 1)
      p += len
      const items: { size: number; offset: number }[] = []
      for (let j = 0; j < count; j++, p += 16) items.push({ size: blk.readUInt32LE(p + 8), offset: blk.readUInt32LE(p + 12) })
      recs.push({ folder, items })
    }
    const names = blk.toString('latin1', p, p + fileNamesLen).split('\0')
    const entries: BsaEntry[] = []
    let n = 0
    for (const r of recs) {
      for (const it of r.items) {
        entries.push({
          folder: r.folder.split('\\').join('/'),
          name: names[n++] ?? '',
          size: it.size & 0x3fffffff,
          offset: it.offset,
          compressed: defaultCompressed !== !!(it.size & 0x40000000)
        })
      }
    }
    if (n !== fileCount) throw new Error('BSA: file count mismatch')
    return { path, version, embedNames, entries }
  } finally {
    closeSync(fd)
  }
}

/** The bytes of one entry (decompressed). */
export function extractEntry(bsa: Bsa, e: BsaEntry): Buffer {
  const fd = openSync(bsa.path, 'r')
  try {
    let raw = read(fd, e.offset, e.size)
    if (bsa.embedNames) raw = raw.subarray(1 + raw[0]!) // bstring "folder\name" prefix
    if (!e.compressed) return raw
    const orig = raw.readUInt32LE(0)
    const out = Buffer.from(lz4.decompress(raw.subarray(4), orig))
    if (out.length !== orig) throw new Error(`BSA: decompressed size mismatch ${out.length} vs ${orig}`)
    return out
  } finally {
    closeSync(fd)
  }
}

/** sha256 of a file, streamed (archives are large). */
export function sha256File(path: string): Promise<string> {
  return new Promise((res, rej) => {
    const h = createHash('sha256')
    createReadStream(path).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej)
  })
}

export const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')
