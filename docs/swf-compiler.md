# SWF compiler (`src/main/swf`)

Compiles a spec IR `Swf` (types from `@inkwell-ui/spec`) into a SWF. Milestone 0.1 scope: frames, shapes, text.

```
compileSwf(ir, { modId, buildDir, ffdec, outPath?, instanceNames? }) -> { swfPath, lint: LintIssue[], timings }
```

`LintIssue = { severity: 'error' | 'warning' | 'info', code, message, nodeId }`. Errors block export (the SWF is still written, minus the offending node). Stages `codegen`, `swf`, `ffdec` are measured with `createStageTimer`; `ffdec` is absent when there is nothing for FFDec to fill in.

**Dependency note.** `@inkwell-ui/spec` is `file:../Inkwell-Spec`, a sibling checkout (branch `feat/foundations`). If its `dist` is missing or stale, run `yarn build` there, then `yarn install --force` here. The compiler imports types only; the CLI script validates with the spec's Zod `Swf`.

## Pipeline

1. `generate.ts` (pure): walks the IR, allocates character ids, returns skeleton tags, one SVG per shape, and AS2 sources.
2. `tags.ts`: tag-level writer (uncompressed FWS v10): `SetBackgroundColor`, `ImportAssets2`, `DefineShape3` placeholders, `DefineEditText`, `DefineSprite`, `PlaceObject2`, `ExportAssets`, `DoInitAction`, `DoAction`, `ShowFrame`, `End`.
3. `compile.ts`: writes `<buildDir>/<swf id>/{base.swf, shapes/<characterId>.svg, shapes.json, as2/...}` and runs one wrapper job `{base, shapes, scripts, out}`. FFDec `-importShapes` keeps the placeholder bounds, so the placeholder has the node's width and height. `shapes.json` maps character id to node id.

## Supported

- **Frame**: nested frames become sprites placed with an instance name (layer name sanitized, deduplicated, or the overlay `instanceName` via `instanceNames`). The root frame's children go on the main timeline. Child order is depth order. Position, rotation and opacity (alpha colour transform).
- **Shape**: cubic paths stay cubic in the SVG `d` (FFDec converts to quadratics, lint warning `curve-approximated`); all subpaths in one even-odd path; solid fills with alpha; solid strokes (centered). Inside/outside strokes draw centered with warning `stroke-alignment-approximated`. Gradient fills draw as their first stop (warning); image fills are skipped (warning).
- **Text** (spec "Text mapping"): `DefineEditText` with `fontId`, `useOutlines`, `ImportAssets2` of the alias from `gfxfontlib.swf`; never `fontClass`, dynamic, read-only. Auto width = `autoSize`, no wrap. Auto height = wrap + multiline + `autoSize`. Fixed = fixed field (wraps). Font size, colour (run fill, solid), alignment, 2px gutter compensation (field grown 4px, moved -2,-2), line height to `leading` (`px - size * 1.2`, percent first converted to px, ratio provisional), letter spacing to px (percent: `size * pct / 100`, via `TextFormat.letterSpacing`).
- **Font alias**: `Everywhere / Medium / 18` becomes `$EverywhereMediumFont` (trailing number = size preset, dropped); a raw `$...Font` also works. Known aliases are the names in vanilla's `fontconfig.txt` (`text.ts`, `KNOWN_ALIASES`). Anything else is lint ERROR `font-unmapped` and the field is omitted.
- **Generated AS2** (only when needed): class `mods.<modId>.<SwfId>Layout` in `__Packages`, exported from an empty sprite, called from `frame_1/DoAction.as`. Sets `_global.gfxExtensions = true`, then per text node, inside `try/catch` that `trace`s a string with the node id: `verticalAlign` (center/bottom), `textAutoSize` (shrink/fit), letter spacing. Each block carries a `// node <id> "<layer>"` comment.

## Text layout fields

Read from the spec IR `Text` node (specVersion 2): `align`, `verticalAlign`, `lineHeight` (`auto` | px | percent of font size), `letterSpacing` (px | percent of font size), `textFit` (`none`|`shrink`|`fit`, GFx `textAutoSize`) and `truncate`. `loadProject` runs the spec's `migrate()` on v1 projects, which moves the old `extra.text` keys into these fields. Text decoration is not in the IR and is no longer linted.

## Not supported (reported, compile continues)

- `image`, `instance`, `component` nodes: warning `unsupported-node`, node and children skipped.
- Hidden nodes (`node-hidden`, info), frame `clipContent` (`clip-ignored`, info), masks (`mask-ignored`), blend modes (`blend-ignored`), bindings/themes, auto-layout (resolved positions are used as is), anchors.
- Text: truncation, mixed styles (first run wins), embedded fonts (`font-unmapped`), gradient text fills (black), text shadow (unproven in game; never emitted).
- Missing child, repeated node, invalid root: `node-missing`, `node-cycle`, `root-invalid`.

## Not verified in game

Nothing here has been loaded in Skyrim. Open questions: rotation direction (Figma counterclockwise is mapped to Flash clockwise), leading ratio 1.2, `TextFormat.letterSpacing` in GFx, `AutoSize` combined with centre/right alignment, and whether an IR with stage 1920x1080 (not the vanilla 1280x720 reference) scales as the HUD expects. FFDec prints "LineCap/LineJoin style not supported" warnings on stderr for strokes; they are harmless.

## Sample

`yarn compile:sample` compiles `samples/hud-minimal` (swf `hud`: a panel rectangle with a stroke and a centred label) to `build/sample.swf`.
