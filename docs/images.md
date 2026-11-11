# Images (`src/main/images`, compiler, sync, deploy)

Figma image fills reach the game in one of two ways, chosen per project. Which one works in Skyrim's Scaleform GFx is **not verified yet**: run the in-game test below and report.

## Where images come from

- **Figma plugin:** a RECTANGLE whose only fill is an image (no stroke) becomes an `image` node (`asset` = Figma image hash, `scaleMode` fill/fit/crop/tile, `fillOpacity` = the paint opacity). Frames send their `fills`; an image fill there becomes a background clip. Other image paints (an ellipse, a rectangle with a stroke) stay shape fills and are skipped (`fill-unsupported`).
- **Sync (protocol 3, spec 4):** after a patch or a hash tree, the server sends `needAssets {hashes}` for image hashes the project lacks (each hash at most once per connection). The plugin answers one `asset {hash, data}` per hash, `data` = base64 PNG (it re-encodes JPEG/GIF/16-bit/interlaced PNG through a canvas). The server checks the hash (40 hex digits, it becomes a file name), decodes the PNG, stores it and rebuilds every SWF that uses it. Bad data gets an `error` (`bad_asset`), nothing is stored.
- **Project:** `assets/<hash>.png` (`createAssetStore`, atomic writes; memory only without a project). Decoded pixels are cached per session.

## Image modes (`project.json` `imageMode`)

| | `embedded` (default) | `dds` |
| --- | --- | --- |
| Game SWF | `DefineBitsLossless2` (premultiplied ARGB, one per image hash) + a `DefineShape3` rectangle with a smoothed bitmap fill, inside a named clip | an empty named clip; the generated class `mods.<mod>.<Swf>Images` creates a child clip `img` and loads `img://textures/Inkwell/<modId>/<hash>.dds` with `MovieClipLoader`, then scales it in `onLoadInit` (FILL also adds a mask clip). Every step is in `try/catch`, Flash 8 level, no `Error`. Log lines go to `trace` and, when it exists, the spike runtime's `_root.inkwellTrace` (`Inkwell.log`). |
| Deploy | the SWF only | also `textures/Inkwell/<modId>/<hash>.dds` per image the deployed SWFs reference (uncompressed BGRA8, no mipmaps; recorded in the deploy manifest, retired like any other file) |
| Preview | the bitmap | the bitmap too (Ruffle cannot load `img://`); the badge says how many images are DDS in the game |

Set it by hand in `project.json` (`"imageMode": "dds"`); there is no UI toggle yet.

Scale modes: `fill` (cover, centred, cropped by the shape or the mask) and `fit` (contain, centred). `crop` is drawn as `fill` and `tile` repeats at 1:1 in embedded mode (`fill` in dds mode); both lint `image-scale-mode` (warning). Rotation, node opacity and the paint opacity (multiplied into the clip alpha; a frame fill's opacity applies to its background clip only) work in both modes. Instance names are the layer name (or the overlay's) like every other node; frame backgrounds are `imageFill`, `imageFill_2`...

## Lint

| Code | Severity | When |
| --- | --- | --- |
| `image-missing-asset` | error | the PNG for a hash is not in `assets/` (or unreadable); the image is not drawn. Normal for a moment during the first sync. |
| `image-too-large` | error | a side over 4096 px |
| `image-not-power-of-two` | warning, dds mode only | a side that is not 64, 128, 256... (the game may refuse such textures; unverified) |
| `image-scale-mode` | warning | `crop`, `tile` or an unknown mode |
| `frame-fill-root-skipped` | info | a solid or gradient fill on the root frame (the stage stays transparent; nested frames draw theirs, `docs/swf-compiler.md`) |

## Modules

- `png.ts`: PNG decode (8-bit, not interlaced; grey, RGB, palette + tRNS, grey+alpha, RGBA; all five filters) and encode (RGBA), on `node:zlib`.
- `dds.ts`: the one DDS module: `writeDds` (BGRA8), `readDdsHeader` (any DDS, FourCC for compressed), `readDdsBgra8`. shortcut: no BC3 encoder.
- `assets.ts`: `createAssetStore`, `ddsRel`, `isAssetHash`.
- `synthetic.ts`: generated test images (quadrants, alpha ramp, corner marker, border); nothing binary is committed.

## In-game test (owner)

`yarn compile:images --deploy` builds both menus from the same sheet (`scripts/image-test-sheet.ts`: 64x64, 256x256 and 256x128 images; 1:1, 2x, FIT, FILL, 50% opacity, rotated 30 degrees, a frame image fill under text) and copies into the MO2 mod `Inkwell Spikes`: `Interface/InkwellImageTest.swf` (embedded, key `[`), `Interface/InkwellImageTestDds.swf` (dds, key `]`), their runtime-spike menu JSON and `textures/Inkwell/ImageTest/<hash>.dds`. Without `--deploy` it writes `build/image-test/` (mod layout) and `build/image-test-project/` (an editor project in dds mode for the preview) only.

In game: enable `Inkwell Spikes`, load a save, press `[` and compare with `]` (Esc or the same key closes). Each item is captioned; blank where an image should be means that mode does not work. Then send `Documents/My Games/Skyrim Special Edition/SKSE/Inkwell.log`: the dds menu logs `image <node> loaded ... reported WxH` or `failed to load` per image.

The runtime spike registers at most 8 menus; with these two, `Inkwell Spikes` has exactly 8.

## Slice test (9-slice / 3-slice, owner)

Before slicing becomes an editor feature, `yarn compile:slice [--deploy]` builds the in-game test of Scaleform's `scale9Grid` (`scripts/slice-test-sheet.ts`, `compile-slice-test.ts`; synthetic images, nothing binary is committed). `--deploy` copies it into the MO2 mod **Inkwell Slice Test** (created if missing; `INKWELL_SLICE_DEPLOY` overrides; never a game Data folder). Two menus with the same cases: Numpad 8 = embedded, Numpad 9 = dds. The images are a 128x128 panel (corners 24) and a horizontal and a vertical 3-slice bar (ends 8); the corners are round and orange, so a stretched corner shows at once.

| Case | Method | Modes |
| --- | --- | --- |
| `*0` | raw, native size (reference) | both |
| `P1`, `V1`, `H1` | no slice, resized (control: must look stretched) | both |
| `P2`, `V2`, `H2` | **A**: `clip.scale9Grid = new flash.geom.Rectangle(...)`, then `_width/_height` | both |
| `P3`, `V3`, `H3` | **B**: the same on a holder clip around the image clip | both |
| `P4`, `V4`, `H4` | **T**: a `DefineScalingGrid` tag in the SWF, placed with a scale matrix | embedded |
| `P5` | **T2**: the tag grid, then `_width/_height` | embedded |
| `P6`, `P7` | A at 48x48 (equals both insets) and 40x40 (smaller than both) | both |

In game: enable the mod, load a save, press Numpad 8, then Numpad 9. Per case id report right (round corners, only edges and centre grow), wrong (oval corners) or blank. Then send `Inkwell.log`: every case logs `[SliceTest] <id> (<method>): scale9Grid set, read back x,y,w,h` (`undefined` = the property does not exist), the size before and after, and for dds `loaded` or `FAILED to load`.

What the result decides: A or B works in dds -> slices are applied at run time to the loaded image clip, no export slicing. Only T works -> embedded mode only; dds needs the image cut into separate textures at export. Nothing works -> the same cut for both modes. P7 shows what the game does when a box is smaller than its insets (the editor will clamp or lint it).

## Sliced images (9-slice / 3-slice)

Plan and reasons: `PLAN-SLICING.md`; in-game evidence: `SPIKES.md` section 17. `slices.json` at the project root (Spec `Slices`, `readSlices`/`writeSlices`) maps an image hash to insets `{l, t, r, b, w, h}` in source px (`w`, `h` = the image size it was set for; a 3-slice has one pair at 0). In embedded mode `imageClip` draws such an image as nine piece clips `p0`..`p8` (row-major; a piece with an empty source is absent), each a bitmap shape of one cell of the shared bitmap, placed scaled onto its cell of the node's box (`src/shared/slice.ts`: corners keep their size, edges and centre stretch; a box smaller than the fixed parts shrinks them together and drops the middle). The clip gets `inkwellSlice` and the class `mods.<mod>.InkwellSlice` (`sliceAs2.ts`) repositions the pieces with `resize(clip, w, h)` (`undefined` keeps that side); the scrollbar calls it for a sliced thumb.

| Lint | Severity | When |
| --- | --- | --- |
| `slice-dds` | warning | the image has a slice but the project is in dds mode (drawn stretched) |
| `slice-size-changed` | warning | the image is not the size the slice was set for (drawn stretched) |
| `slice-box-small` | info | the box is smaller than the fixed parts |

Session: `getSlices()` / `saveSlices(doc)` (the save rebuilds every SWF). Until the Asset View exists, edit `slices.json` by hand: `{"specVersion": 8, "assets": {"<40 hex hash>": {"l": 24, "t": 24, "r": 24, "b": 24, "w": 128, "h": 128}}}`.
