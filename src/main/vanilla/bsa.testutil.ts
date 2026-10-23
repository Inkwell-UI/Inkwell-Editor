import lz4 from 'lz4js'

export interface F { folder: string; name: string; data: Buffer; compress?: boolean }

/** Builds a tiny v105 archive: one folder per distinct folder name; `compress` entries are LZ4 frames behind a u32 original size. */
export function buildBsa(files: F[], opts: { defaultCompressed?: boolean; embedNames?: boolean } = {}): Buffer {
  const folderNames = [...new Set(files.map((f) => f.folder))]
  const byFolder = folderNames.map((fo) => files.filter((f) => f.folder === fo))
  const ordered = byFolder.flat()
  const fileNames = Buffer.from(ordered.map((f) => f.name + '\0').join(''), 'latin1')
  const folderRecs = 36
  const blockStart = folderRecs + folderNames.length * 24
  const blockLen = byFolder.reduce((n, fs, i) => n + 1 + folderNames[i]!.length + 1 + fs.length * 16, 0)
  const dataStart = blockStart + blockLen + fileNames.length
  const payloads = ordered.map((f) => {
    const compressed = opts.defaultCompressed ? f.compress !== false : !!f.compress
    let body = compressed ? Buffer.concat([u32(f.data.length), Buffer.from(lz4.compress(f.data))]) : f.data
    if (opts.embedNames) body = Buffer.concat([Buffer.from([f.name.length]), Buffer.from(f.name, 'latin1'), body])
    return { body, toggled: compressed !== !!opts.defaultCompressed }
  })
  const head = Buffer.alloc(36)
  head.write('BSA\0', 0, 'latin1')
  head.writeUInt32LE(105, 4)
  head.writeUInt32LE(36, 8)
  head.writeUInt32LE((opts.defaultCompressed ? 4 : 0) | (opts.embedNames ? 0x100 : 0), 12)
  head.writeUInt32LE(folderNames.length, 16)
  head.writeUInt32LE(ordered.length, 20)
  head.writeUInt32LE(folderNames.reduce((n, f) => n + f.length + 1, 0), 24)
  head.writeUInt32LE(fileNames.length, 28)
  const folderBuf = Buffer.alloc(folderNames.length * 24)
  let blockPos = blockStart
  byFolder.forEach((fs, i) => {
    folderBuf.writeUInt32LE(fs.length, i * 24 + 8)
    folderBuf.writeBigUInt64LE(BigInt(blockPos + fileNames.length), i * 24 + 16)
    blockPos += 1 + folderNames[i]!.length + 1 + fs.length * 16
  })
  const parts: Buffer[] = [head, folderBuf]
  let off = dataStart
  let k = 0
  byFolder.forEach((fs, i) => {
    parts.push(Buffer.from([folderNames[i]!.length + 1]), Buffer.from(folderNames[i]! + '\0', 'latin1'))
    for (let j = 0; j < fs.length; j++, k++) {
      const rec = Buffer.alloc(16)
      rec.writeUInt32LE((payloads[k]!.body.length | (payloads[k]!.toggled ? 0x40000000 : 0)) >>> 0, 8)
      rec.writeUInt32LE(off, 12)
      off += payloads[k]!.body.length
      parts.push(rec)
    }
  })
  parts.push(fileNames, ...payloads.map((p) => p.body))
  return Buffer.concat(parts)
}
const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}
