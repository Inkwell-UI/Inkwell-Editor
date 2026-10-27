import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

/**
 * Reads a plain zip (stored or deflate, no zip64, no encryption) into name -> bytes; directory entries are skipped. Untrusted input (pack
 * downloads): a name that is absolute, has a drive, a backslash or `..` is refused, every entry's CRC is checked and the total size is capped.
 */
export function readZip(buf: Buffer, maxTotal = 64 * 1024 * 1024): Map<string, Buffer> {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('Not a zip file.')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const out = new Map<string, Buffer>()
  let total = 0
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Broken zip central directory.')
    const method = buf.readUInt16LE(p + 10)
    const crc = buf.readUInt32LE(p + 16)
    const size = buf.readUInt32LE(p + 20)
    const raw = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32)
    if (name.endsWith('/')) continue
    if (!name || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..')) throw new Error(`Unsafe zip entry name "${name}".`)
    if ((total += raw) > maxTotal) throw new Error('The zip is too large.')
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`Broken zip entry "${name}".`)
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const body = buf.subarray(start, start + size)
    const data = method === 0 ? Buffer.from(body) : method === 8 ? inflateRawSync(body, { maxOutputLength: Math.max(raw, 1) }) : undefined
    if (!data) throw new Error(`Zip entry "${name}" uses an unsupported compression method (${method}).`)
    if (data.length !== raw || crc32(data) !== crc) throw new Error(`Zip entry "${name}" is corrupt.`)
    out.set(name, data)
  }
  return out
}

/** DOS date 1980-01-01 00:00: every entry gets the same time so two packages of the same files are byte-identical. */
const DOS_DATE = (0 << 9) | (1 << 5) | 1
const UTF8 = 1 << 11

/**
 * A plain zip (no zip64, no directory entries) of `files`, sorted by name: deflate when it is smaller, else stored; UTF-8 names (flag bit 11);
 * a fixed timestamp and no extra fields, so the output depends only on the names and bytes. Names use forward slashes and must be relative.
 */
export function writeZip(files: Iterable<{ name: string; data: Uint8Array }>): Buffer {
  const list = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  if (list.length > 0xffff) throw new Error('Too many files for a zip without zip64.')
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const f of list) {
    if (!f.name || f.name.includes('\\') || f.name.startsWith('/') || f.name.split('/').includes('..')) throw new Error(`Bad zip entry name "${f.name}".`)
    const name = Buffer.from(f.name, 'utf8')
    const deflated = deflateRawSync(f.data, { level: 9 })
    const stored = deflated.length >= f.data.length
    const body = stored ? Buffer.from(f.data) : deflated
    const crc = crc32(f.data)
    if (offset + 30 + name.length + body.length > 0xffffffff) throw new Error('The package is larger than 4 GB (zip64 is not supported).')
    const head = (sig: number, size: number): Buffer => {
      const b = Buffer.alloc(size)
      b.writeUInt32LE(sig, 0)
      return b
    }
    const l = head(0x04034b50, 30)
    l.writeUInt16LE(20, 4) // version needed: 2.0 (deflate)
    l.writeUInt16LE(UTF8, 6)
    l.writeUInt16LE(stored ? 0 : 8, 8)
    l.writeUInt16LE(0, 10) // time 00:00
    l.writeUInt16LE(DOS_DATE, 12)
    l.writeUInt32LE(crc, 14)
    l.writeUInt32LE(body.length, 18)
    l.writeUInt32LE(f.data.length, 22)
    l.writeUInt16LE(name.length, 26)
    const c = head(0x02014b50, 46)
    c.writeUInt16LE(20, 4) // made by: MS-DOS/FAT, 2.0 (no Unix permission bits)
    c.writeUInt16LE(20, 6)
    c.writeUInt16LE(UTF8, 8)
    c.writeUInt16LE(stored ? 0 : 8, 10)
    c.writeUInt16LE(DOS_DATE, 14)
    c.writeUInt32LE(crc, 16)
    c.writeUInt32LE(body.length, 20)
    c.writeUInt32LE(f.data.length, 24)
    c.writeUInt16LE(name.length, 28)
    c.writeUInt32LE(offset, 42)
    locals.push(l, name, body)
    central.push(c, name)
    offset += 30 + name.length + body.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(list.length, 8)
  end.writeUInt16LE(list.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}
