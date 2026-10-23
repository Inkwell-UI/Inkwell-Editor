import { existsSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { open, extract } from "./bsa.js";
import { swfInfo, DEFAULT_BSA } from "./cli.js";

describe.skipIf(!existsSync(DEFAULT_BSA))("real Skyrim - Interface.bsa", () => {
  it("extracts inventorymenu.swf as a valid SWF", () => {
    const bsa = open(DEFAULT_BSA);
    expect(bsa.entries.length).toBeGreaterThan(100);
    const e = bsa.entries.find((x) => `${x.folder}/${x.name}`.toLowerCase() === "interface/inventorymenu.swf")!;
    expect(e).toBeTruthy();
    const info = swfInfo(extract(bsa, e)); // throws on bad sig / length mismatch
    expect(info.version).toBeGreaterThan(0);
    expect(info.width).toBeGreaterThan(0);
  });
});

describe.skipIf(!existsSync(DEFAULT_BSA))("all entries", () => {
  it("every .swf decodes and validates", () => {
    const bsa = open(DEFAULT_BSA);
    const swfs = bsa.entries.filter((e) => e.name.toLowerCase().endsWith(".swf"));
    for (const e of swfs) swfInfo(extract(bsa, e));
    expect(swfs.length).toBeGreaterThan(50);
  });
});

import lz4 from "lz4js";
it("lz4js round-trips an LZ4 frame (real archive has no compressed entries)", () => {
  const src = Buffer.from("inkwell ".repeat(5000));
  expect(Buffer.from(lz4.decompress(lz4.compress(src), src.length)).equals(src)).toBe(true);
});
