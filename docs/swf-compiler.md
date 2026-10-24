# SWF compiler (`src/main/swf`)

Compiles one spec IR `Swf` (one per top-level Figma frame; the sync server builds each independently into `<project>/build/<name>.swf`) (types from `@inkwell-ui/spec`) into a SWF. Milestone 0.1 scope: frames, shapes, text.

```
compileSwf(ir, { modId, buildDir, ffdec, outPath?, instanceNames? }) -> { swfPath, lint: LintIssue[], timings }
```

`LintIssue = { severity: 'error' | 'warning' | 'info', code, message, nodeId }`. Errors block export (the SWF is still written, minus the offending node; Deploy's export gate refuses it, `docs/deploy.md`). Layout lint added for the gate: `node-off-stage` (warning: a visible layer whose box is entirely outside the frame, one per subtree; rotated layers are not checked), `text-zero-size` (warning: a text box with no width or height), `instance-name-duplicate` (warning: an overlay instance name a sibling already uses, so this clip compiles as `<name>_2`; clashes of plain layer names stay silent). Stages `codegen`, `swf`, `ffdec` are measured with `createStageTimer`; `ffdec` is absent when there is nothing for FFDec to fill in.

**Dependency note.** `@inkwell-ui/spec` is `link:../Inkwell-Spec`, a link to the sibling checkout (specVersion 4). If its `dist` is missing or stale, run `yarn build` there; nothing needs reinstalling here. The compiler imports types only; the CLI script validates with the spec's Zod `Swf`.

## Pipeline

1. `generate.ts` (pure): walks the IR, allocates character ids, returns skeleton tags, one SVG per shape, and AS2 sources.
2. `tags.ts`: tag-level writer (uncompressed FWS v10): `SetBackgroundColor`, `ImportAssets2`, `DefineShape3` placeholders, `DefineEditText`, `DefineSprite`, `PlaceObject2`, `ExportAssets`, `DoInitAction`, `DoAction`, `ShowFrame`, `End`.
3. `compile.ts`: writes `<buildDir>/<swf id>/{base.swf, shapes/<characterId>.svg, shapes.json, as2/...}` and runs one wrapper job `{base, shapes, scripts, out}`. FFDec `-importShapes` keeps the placeholder bounds, so the placeholder has the node's width and height. `shapes.json` maps character id to node id.

## Supported

- **Frame**: nested frames become sprites placed with an instance name (layer name sanitized, deduplicated, or the overlay `instanceName` via `instanceNames`). The root frame's children go on the main timeline. Child order is depth order. Position, rotation and opacity (alpha colour transform).
- **Shape**: cubic paths stay cubic in the SVG `d` (FFDec converts to quadratics, lint warning `curve-approximated`); all subpaths in one even-odd path; solid fills with alpha; solid strokes (centered). Inside/outside strokes draw centered with warning `stroke-alignment-approximated`. Gradient fills draw as their first stop (warning); image fills on shapes are skipped (warning `fill-unsupported`).
- **Image** nodes and frame image fills: a named clip with an embedded bitmap, or an empty clip loaded from DDS at runtime, per the project's `imageMode`; see `docs/images.md`.
- **Text** (spec "Text mapping"): `DefineEditText` with `fontId`, `useOutlines`, `ImportAssets2` of the alias from `gfxfontlib.swf` (one tag per alias, as vanilla: in game only the first asset of a multi-asset tag resolved, the others drew boxes); never `fontClass`, dynamic, read-only. Auto width = `autoSize`, no wrap. Auto height = wrap + multiline + `autoSize`. Fixed = fixed field (wraps). Font size, colour (run fill, solid), alignment, 2px gutter compensation (field grown 4px, moved -2,-2), line height to `leading` (`px - size * 1.2`, percent first converted to px, ratio provisional), letter spacing to px (percent: `size * pct / 100`, via `TextFormat.letterSpacing`).
- **Font alias** (`resolveFont` in `text.ts`), in this order: (a) the Figma text style name (`font.styleName`) when it is alias-shaped, e.g. `Everywhere / Medium / 18` -> `$EverywhereMediumFont` (trailing number = size preset, dropped; a raw `$...Font` also works); (b) the font `family/style` the same way (family `Everywhere`, style `Medium` -> `$EverywhereMediumFont`); (c) the fallback table `fallbackAlias`, with a lint WARNING `font-fallback`: Inter, Roboto, Arial, Helvetica, Open Sans, Lato, Montserrat, Segoe, SF Pro, Calibri, Verdana, Tahoma, Noto Sans, Poppins, Source Sans -> `$EverywhereFont` (bold/black/heavy -> `$EverywhereBoldFont`, medium/semibold -> `$EverywhereMediumFont`); names containing mono/courier/consol/menlo/monaco/fira code -> `$ConsoleFont`; names containing script/hand/brush/cursive (and a few known) -> `$HandwrittenFont`; (d) otherwise lint ERROR `font-unmapped` and the field is omitted. Known aliases are the names in vanilla's `fontconfig.txt` (`KNOWN_ALIASES`); `$SkyrimBooks` (family `SkyrimBooks`, style `Regular`) is the one without the `Font` suffix and is imported by that name like the others (not yet seen in game). Fallback and unmapped messages quote the original Figma font and text style name.
- **Generated AS2** (only when needed): class `mods.<modId>.<SwfId>Layout` in `__Packages`, exported from an empty sprite, called from `frame_1/DoAction.as`. Sets `_global.gfxExtensions = true`, then per text node, inside `try/catch` that `trace`s a string with the node id: `verticalAlign` (center/bottom), `textAutoSize` (shrink/fit), letter spacing. Each block carries a `// node <id> "<layer>"` comment.

## Preview text fonts

`preview: true` text uses the font named `previewFont(alias)`; when `previewFontBytes(name)` returns a TTF it is EMBEDDED (placeholder `DefineFont3` + `fontId` + outlines, glyph subset imported by the FFDec `fonts` job; needed because Ruffle draws no device-font text when rotated), else `fontClass` (default `previewDeviceFont`: `_sans`, `_typewriter`, `_serif`). Layout, bounds and alignment are identical to the game SWF. See `docs/preview-fonts.md`.

## Text layout fields

Read from the spec IR `Text` node (specVersion 2+): `align`, `verticalAlign`, `lineHeight` (`auto` | px | percent of font size), `letterSpacing` (px | percent of font size), `textFit` (`none`|`shrink`|`fit`, GFx `textAutoSize`) and `truncate`. `loadProject` runs the spec's `migrate()` on v1 projects, which moves the old `extra.text` keys into these fields. Text decoration is not in the IR and is no longer linted.

## Not supported (reported, compile continues)

- `instance`, `component` nodes: warning `unsupported-node`, node and children skipped.
- Hidden nodes (`node-hidden`, info), frame `clipContent` (`clip-ignored`, info), masks (`mask-ignored`), blend modes (`blend-ignored`), bindings/themes, auto-layout (resolved positions are used as is), anchors.
- Text: truncation, mixed styles (first run wins), embedded fonts (`font-unmapped`), gradient text fills (black), text shadow (unproven in game; never emitted).
- Missing child, repeated node, invalid root: `node-missing`, `node-cycle`, `root-invalid`.

## Verified in game

The test sheet (`yarn compile:ingame`, opened as runtime menus `,` for 1280x720 and `.` for 1920x1080) was checked on Skyrim SE 1.7.104: shapes with alpha and strokes, cubic curves, rotation direction (Figma counterclockwise rises to the right), all seven font aliases, alignment, wrapping, line height, letter spacing, `verticalAlign` and `textAutoSize`. A 1920x1080 stage works. Every font needs its own `ImportAssets2` tag (one asset per tag); a shared tag renders only its first font. See SPIKES.md section 11.

Still unmeasured: pixel accuracy of letter spacing and of `autoSize` with centre or right alignment. FFDec prints "LineCap/LineJoin style not supported" warnings on stderr for strokes; they are harmless.

## Sample

`yarn compile:sample` compiles `samples/hud-minimal` (swf `hud`: a panel rectangle with a stroke and a centred label) to `build/sample.swf`.

## In-game test sheet

`yarn compile:ingame` regenerates `samples/ingame-test` (swfs `ingametest` 1920x1080 and `ingametest720` 1280x720, both from `scripts/ingame-test-sheet.ts` with one scale factor) and compiles them to `build/ingametest.swf` and `build/ingametest720.swf`. It prints lint and timings; any lint error is printed loudly and the exit code is 1. The sheet has captioned sections A-J on a dark background: alpha + stroke, ellipse/curve/triangle, a 30 degree rotation (should rise to the right), all font aliases, sizes, alignment, auto/fixed sizing, line height, letter spacing, vertical align and textFit. Nothing on it has been seen in game yet. Layout is pure (`buildSheet`), so changing the sheet means editing that file only.
