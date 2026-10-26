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
