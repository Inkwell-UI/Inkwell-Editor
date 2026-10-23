# Spike 5: BSA reader

**Question:** can a TypeScript module read SSE `Skyrim - Interface.bsa` (v105) and extract a vanilla SWF into a git-ignored cache?

**Answer: yes.**

## Built
- `bsa.ts`: `open(path)` (index parse -> entries `{folder,name,size,offset,compressed}`), `extract(bsa, entry)` -> Buffer, `archiveHash(path)` (streaming sha256). Handles v105 24-byte folder records, embed-names flag (0x100), default-compression flag (0x4) XOR per-file bit 30, 4-byte original-size prefix + LZ4 frame (pure JS `lz4js`).
- `cli.ts`: `swfInfo()` (signature, zlib inflate for CWS, declared-length check, version, stage size) and a CLI.
- `bsa.test.ts`: vitest on the real archive (skipped if absent).

## Run
```
npm i
npx tsx cli.ts list inventory
npx tsx cli.ts extract interface/inventorymenu.swf   # -> .cache/<sha256>/interface/inventorymenu.swf
npm test
```
`.cache/` and `node_modules/` are git-ignored. Archive path is hard-coded to the Steam default (no game location logic in the spike).

## Result (game 1.7.104 AE archive)
- 415 entries, 53 SWFs. Header layout verified: 36-byte header, 24-byte folder records, first folder's file-block offset = end of folder records + total filename length.
- `interface/inventorymenu.swf`: CWS, SWF version 15, declared length 178456 (matches inflated size), stage 1280x720 px. Archive sha256 `e3d0c8d1...24de`.
- All 53 SWFs extract and validate (signature + zlib + length).

## Measurements
- Open (index parse): ~24-46 ms (cold-ish first run 46 ms)
- Extract one SWF: ~1.5 ms
- sha256 of 107 MB: ~150 ms
- Entries: 415

## Caveats
- This archive stores **no compressed entries and no embedded names**, so the LZ4 path is NOT exercised on real data; only a lz4js frame round-trip is tested. Needs a compressed v105 BSA (e.g. a mod's) to prove it.
- **Update (review, 2026-10-23, SPIKES.md spike 5):** the LZ4 path is now verified on real data. 8 of 14 mod BSAs in MO2 have the compression flag; `bsa.ts` extracted all 51 compressed entries of `Quick Start - SE.bsa` (4) and `DBM_RelicNotifications - Textures.bsa` (47, 126 MB). Decompressed size equals the stored original size and each file starts with a valid `DDS ` magic. **Not byte-compared with a reference extractor (BSArch)**; a golden byte-compare test is still to do. Steam/GOG path discovery is also still missing (path hard-coded). `SkyUI_SE.bsa` (71 entries) has 0 compressed, so it does not exercise LZ4.
- `fonts_pl.swf` has 8 trailing bytes after its declared length; the check accepts declared <= actual and reports `trailing`.
- Index read assumes the folder/file-name block is under 64 MB (true here, tiny).
- `size` in entries is the stored size (compressed if compressed).
