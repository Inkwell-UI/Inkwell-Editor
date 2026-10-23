import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

/** One entry of a zip/jar (stored or deflated), or undefined. Used to read FFDec's own version from `ffdec_lib.jar` without unpacking it. */
export function readZipEntry(file: string | Buffer, name: string): Buffer | undefined {
  const b = typeof file === 'string' ? readFileSync(file) : file
  let eocd = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return undefined
  let p = b.readUInt32LE(eocd + 16)
  for (let n = b.readUInt16LE(eocd + 10); n > 0 && b.readUInt32LE(p) === 0x02014b50; n--) {
    const method = b.readUInt16LE(p + 10)
    const csize = b.readUInt32LE(p + 20)
    const nameLen = b.readUInt16LE(p + 28)
    const extraLen = b.readUInt16LE(p + 30)
    const commentLen = b.readUInt16LE(p + 32)
    const local = b.readUInt32LE(p + 42)
    if (b.toString('utf8', p + 46, p + 46 + nameLen) === name) {
      const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28)
      const data = b.subarray(start, start + csize)
      return method === 0 ? data : method === 8 ? inflateRawSync(data) : undefined
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  return undefined
}
