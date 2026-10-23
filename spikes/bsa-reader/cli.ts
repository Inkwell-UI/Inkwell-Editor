import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { inflateSync } from "node:zlib";
import { open, extract, archiveHash } from "./bsa.js";

export const DEFAULT_BSA = "D:/SteamLibrary/steamapps/common/Skyrim Special Edition/Data/Skyrim - Interface.bsa";

/** Returns SWF signature, version, declared length, stage size in twips->px. Throws if inconsistent. */
export function swfInfo(buf: Buffer) {
  const sig = buf.toString("latin1", 0, 3);
  if (sig !== "CWS" && sig !== "FWS") throw new Error(`bad signature ${sig}`);
  const body = sig === "CWS" ? Buffer.concat([buf.subarray(0, 8), inflateSync(buf.subarray(8))]) : buf;
  const declared = body.readUInt32LE(4);
  if (declared > body.length) throw new Error(`declared length ${declared} != ${body.length}`);
  const nbits = body[8] >> 3; // RECT: 4 fields of nbits (xmin,xmax,ymin,ymax)
  let bit = 5;
  const f = () => { let v = 0; for (let i = 0; i < nbits; i++, bit++) v = v * 2 + ((body[8 + (bit >> 3)] >> (7 - (bit & 7))) & 1); return v; };
  const xmin = f(), xmax = f(), ymin = f(), ymax = f();
  return { sig, version: buf[3], length: declared, trailing: body.length - declared, width: (xmax - xmin) / 20, height: (ymax - ymin) / 20 };
}

if (process.argv[1]?.endsWith("cli.ts")) {
  const [cmd, arg, bsaPath = DEFAULT_BSA] = process.argv.slice(2);
  let t = performance.now();
  const bsa = open(bsaPath);
  console.log(`opened ${bsa.entries.length} entries in ${(performance.now() - t).toFixed(1)} ms`);
  const full = (e: { folder: string; name: string }) => `${e.folder}/${e.name}`.toLowerCase();
  if (cmd === "list") {
    const re = new RegExp(arg ?? ".", "i");
    for (const e of bsa.entries) if (re.test(full(e))) console.log(full(e), e.size);
  } else if (cmd === "extract") {
    const e = bsa.entries.find((x) => full(x) === arg.toLowerCase());
    if (!e) throw new Error("not found: " + arg);
    t = performance.now();
    const buf = extract(bsa, e);
    console.log(`extracted ${buf.length} bytes in ${(performance.now() - t).toFixed(1)} ms`);
    t = performance.now();
    const hash = await archiveHash(bsaPath);
    console.log(`sha256 ${hash} in ${(performance.now() - t).toFixed(0)} ms`);
    const out = join(import.meta.dirname, ".cache", hash, full(e));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, buf);
    console.log(out, swfInfo(buf));
  } else console.log("usage: cli.ts list <regex> | extract interface/inventorymenu.swf [bsa]");
}
