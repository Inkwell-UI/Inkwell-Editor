import { openSync, readSync, closeSync, createReadStream, fstatSync } from "node:fs";
import { createHash } from "node:crypto";
import lz4 from "lz4js";

export interface Entry { folder: string; name: string; size: number; offset: number; compressed: boolean }
export interface Bsa { path: string; version: number; embedNames: boolean; entries: Entry[] }

const read = (fd: number, pos: number, len: number) => {
  const b = Buffer.alloc(len);
  if (readSync(fd, b, 0, len, pos) !== len) throw new Error("short read");
  return b;
};

export function open(path: string): Bsa {
  const fd = openSync(path, "r");
  try {
    const h = read(fd, 0, 36);
    if (h.toString("latin1", 0, 4) !== "BSA\0") throw new Error("not a BSA");
    const version = h.readUInt32LE(4);
    if (version !== 105) throw new Error(`unsupported BSA version ${version}`);
    const flags = h.readUInt32LE(12), folderCount = h.readUInt32LE(16), fileCount = h.readUInt32LE(20);
    const fileNamesLen = h.readUInt32LE(28);
    const defaultCompressed = !!(flags & 0x4), embedNames = !!(flags & 0x100);
    const FREC = 24; // v105 folder record: hash u64, count u32, pad u32, offset u64 (v104 is 16)
    const folders = read(fd, h.readUInt32LE(8), folderCount * FREC);
    // one read for the folder blocks + file name block (everything after the folder records)
    const blockStart = 36 + folderCount * FREC, size = fstatSync(fd).size;
    const first = Number(folders.readBigUInt64LE(16)) - fileNamesLen;
    if (first !== blockStart) throw new Error(`unexpected layout ${first} vs ${blockStart}`);
    const nameBlockEnd = blockStart; // computed below
    void nameBlockEnd;
    // file block size = per folder (1+len) + count*16; names follow
    // simplest: read the lot up to the first file data, found as min file offset; use generous bound
    const blk = read(fd, blockStart, Math.min(size - blockStart, 64 * 1024 * 1024));
    const recs: { folder: string; items: { size: number; offset: number }[] }[] = [];
    let p = 0;
    for (let i = 0; i < folderCount; i++) {
      const count = folders.readUInt32LE(i * FREC + 8);
      const len = blk[p++];
      const folder = blk.toString("latin1", p, p + len - 1); p += len;
      const items = [];
      for (let j = 0; j < count; j++, p += 16) items.push({ size: blk.readUInt32LE(p + 8), offset: blk.readUInt32LE(p + 12) });
      recs.push({ folder, items });
    }
    const names = blk.toString("latin1", p, p + fileNamesLen).split("\0");
    const entries: Entry[] = [];
    let n = 0;
    for (const r of recs) for (const it of r.items)
      entries.push({ folder: r.folder.split(String.fromCharCode(92)).join("/"), name: names[n++],
        size: it.size & 0x3fffffff, offset: it.offset,
        compressed: defaultCompressed !== !!(it.size & 0x40000000) });
    if (n !== fileCount) throw new Error("file count mismatch");
    return { path, version, embedNames, entries };
  } finally { closeSync(fd); }
}

export function extract(bsa: Bsa, e: Entry): Buffer {
  const fd = openSync(bsa.path, "r");
  try {
    let raw = read(fd, e.offset, e.size);
    if (bsa.embedNames) raw = raw.subarray(1 + raw[0]); // bstring "folder\name" prefix
    if (!e.compressed) return raw;
    const orig = raw.readUInt32LE(0);
    const out = Buffer.from(lz4.decompress(raw.subarray(4), orig));
    if (out.length !== orig) throw new Error(`size mismatch ${out.length} vs ${orig}`);
    return out;
  } finally { closeSync(fd); }
}

export function archiveHash(path: string): Promise<string> {
  return new Promise((res, rej) => {
    const h = createHash("sha256");
    createReadStream(path).on("data", (d) => h.update(d)).on("end", () => res(h.digest("hex"))).on("error", rej);
  });
}
