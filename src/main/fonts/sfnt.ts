// Minimal TrueType (sfnt) container: read the table directory, write tables back with checksums. Only what the font tool needs.

export type Tables = Map<string, Buffer>

/** Tables of a TrueType file (copies); throws on anything that is not a well-formed sfnt. */
export function readSfnt(b: Buffer): Tables {
  if (b.length < 12) throw new Error('Not a TrueType font (too short)')
  const v = b.readUInt32BE(0)
  if (v !== 0x00010000 && v !== 0x74727565) throw new Error('Not a TrueType font')
  const n = b.readUInt16BE(4)
  if (12 + n * 16 > b.length) throw new Error('TrueType table directory is truncated')
  const out: Tables = new Map()
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16
    const off = b.readUInt32BE(o + 8)
    const len = b.readUInt32BE(o + 12)
    if (off + len > b.length) throw new Error('TrueType table is truncated')
    out.set(b.toString('latin1', o, o + 4), Buffer.from(b.subarray(off, off + len)))
  }
  return out
}

const checksum = (b: Buffer): number => {
  let s = 0
  const p = Buffer.alloc((b.length + 3) & ~3)
  b.copy(p)
  for (let i = 0; i < p.length; i += 4) s = (s + p.readUInt32BE(i)) >>> 0
  return s
}

/** Serialises tables (sorted by tag, 4-byte aligned, checksums and head.checkSumAdjustment set). */
export function writeSfnt(tables: Tables): Buffer {
  const tags = [...tables.keys()].sort()
  const n = tags.length
  const sr = 2 ** Math.floor(Math.log2(n || 1))
  const head = Buffer.alloc(12 + n * 16)
  head.writeUInt32BE(0x00010000, 0)
  head.writeUInt16BE(n, 4)
  head.writeUInt16BE(sr * 16, 6)
  head.writeUInt16BE(Math.log2(sr), 8)
  head.writeUInt16BE(n * 16 - sr * 16, 10)
  const parts: Buffer[] = [head]
  let off = head.length
  tags.forEach((tag, i) => {
    const t = Buffer.from(tables.get(tag)!)
    if (tag === 'head' && t.length >= 12) t.writeUInt32BE(0, 8)
    const o = 12 + i * 16
    head.write(tag.padEnd(4, ' '), o, 'latin1')
    head.writeUInt32BE(checksum(t), o + 4)
    head.writeUInt32BE(off, o + 8)
    head.writeUInt32BE(t.length, o + 12)
    const padded = Buffer.alloc((t.length + 3) & ~3)
    t.copy(padded)
    parts.push(padded)
    off += padded.length
  })
  const font = Buffer.concat(parts)
  const hi = tags.indexOf('head')
  if (hi >= 0) font.writeUInt32BE((0xb1b0afba - checksum(font)) >>> 0, font.readUInt32BE(12 + hi * 16 + 8) + 8)
  return font
}

/** A Windows (3, 1, 0x409) name record string, else the Mac Roman (1, 0) one; undefined if absent. */
export function nameString(name: Buffer, id: number): string | undefined {
  const count = name.readUInt16BE(2)
  const strings = name.readUInt16BE(4)
  let mac: string | undefined
  for (let r = 0; r < count; r++) {
    const q = 6 + r * 12
    if (name.readUInt16BE(q + 6) !== id) continue
    const [pl, len, off] = [name.readUInt16BE(q), name.readUInt16BE(q + 8), name.readUInt16BE(q + 10)]
    const raw = name.subarray(strings + off, strings + off + len)
    if (pl === 3) return Buffer.from(raw).swap16().toString('utf16le')
    // shortcut: decodes Mac Roman as latin1 (exact for ASCII); FFDec always writes a Windows record too
    if (pl === 1) mac ??= raw.toString('latin1')
  }
  return mac
}

/** A format-0 name table of Windows English records only. */
export function buildNameTable(records: Record<number, string>): Buffer {
  const ids = Object.keys(records).map(Number).sort((a, b) => a - b)
  const data = ids.map((id) => Buffer.from(records[id]!, 'utf16le').swap16())
  const head = Buffer.alloc(6 + ids.length * 12)
  head.writeUInt16BE(ids.length, 2)
  head.writeUInt16BE(head.length, 4)
  let off = 0
  ids.forEach((id, i) => {
    const q = 6 + i * 12
    head.writeUInt16BE(3, q)
    head.writeUInt16BE(1, q + 2)
    head.writeUInt16BE(0x409, q + 4)
    head.writeUInt16BE(id, q + 6)
    head.writeUInt16BE(data[i]!.length, q + 8)
    head.writeUInt16BE(off, q + 10)
    off += data[i]!.length
  })
  return Buffer.concat([head, ...data])
}

/**
 * Characters a TrueType font maps (cmap formats 0, 4, 12; Unicode subtables only), or undefined when it has none we can read.
 * Takes the raw file; cheap (reads only the table directory and the cmap).
 */
export function cmapCodePoints(b: Buffer): Set<number> | undefined {
  try {
    const cmap = readSfnt(b).get('cmap')
    if (!cmap || cmap.length < 4) return undefined
    const subs: { pl: number; en: number; off: number }[] = []
    for (let i = 0, n = cmap.readUInt16BE(2); i < n; i++) subs.push({ pl: cmap.readUInt16BE(4 + i * 8), en: cmap.readUInt16BE(6 + i * 8), off: cmap.readUInt32BE(8 + i * 8) })
    const rank = (s: { pl: number; en: number }): number => (s.pl === 3 && s.en === 10 ? 3 : s.pl === 3 && s.en === 1 ? 2 : s.pl === 0 ? 1 : 0)
    const sub = subs.filter((s) => rank(s)).sort((a, c) => rank(c) - rank(a))[0]
    if (!sub) return undefined
    const o = sub.off
    const out = new Set<number>()
    const fmt = cmap.readUInt16BE(o)
    if (fmt === 4) {
      const segs = cmap.readUInt16BE(o + 6) / 2
      const end = o + 14
      const start = end + segs * 2 + 2
      const delta = start + segs * 2
      const range = delta + segs * 2
      for (let s = 0; s < segs; s++) {
        const [e, st, rOff] = [cmap.readUInt16BE(end + s * 2), cmap.readUInt16BE(start + s * 2), cmap.readUInt16BE(range + s * 2)]
        for (let c = st; c <= e && c < 0xffff; c++) {
          if (rOff === 0) {
            if (((c + cmap.readInt16BE(delta + s * 2)) & 0xffff) !== 0) out.add(c)
          } else {
            const g = cmap.readUInt16BE(range + s * 2 + rOff + (c - st) * 2)
            if (g !== 0) out.add(c)
          }
        }
      }
    } else if (fmt === 12) {
      for (let g = 0, n = cmap.readUInt32BE(o + 12); g < n; g++) {
        const q = o + 16 + g * 12
        const [st, e, gid] = [cmap.readUInt32BE(q), cmap.readUInt32BE(q + 4), cmap.readUInt32BE(q + 8)]
        if (e - st > 0x20000) return undefined
        for (let c = st; c <= e; c++) if (gid + (c - st) !== 0) out.add(c)
      }
    } else if (fmt === 0) {
      for (let c = 0; c < 256; c++) if (cmap.readUInt8(o + 6 + c) !== 0) out.add(c)
    } else return undefined
    return out
  } catch {
    return undefined // truncated or malformed: coverage unknown
  }
}
