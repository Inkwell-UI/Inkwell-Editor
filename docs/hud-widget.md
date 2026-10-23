# HUD widget output (`src/main/widget`)

Milestone 0.1 items 14-16. `compileWidget(ir, { modId, widgetName?, buildDir, ffdec, papyrusExe? })` turns an IR whose `target.kind` is `hudWidget` into an in-memory mod folder (`{ files, lint, timings }`); `writeModFolder(dir, files)` writes it.

## What is generated

```
Interface/exported/widgets/<modId>/<widgetName>.swf   the widget SWF
Scripts/<modId>_<widgetName>.pex                      compiled widget script
Scripts/<modId>_<widgetName>Instance.pex              compiled empty Instance script
Source/Scripts/<modId>_<widgetName>.psc               generated sources, shipped for readability
Source/Scripts/<modId>_<widgetName>Instance.psc
<modId>.esp                                           ESL-flagged plugin, master SkyUI_SE.esp
```

- **Widget frame.** The first frame child of the root frame is the widget (a root with no frame child is the widget itself). Its children become the content of the root clip; its position, anchor and opacity go to the Papyrus script, not into the SWF. Other top-level layers are skipped with warning `widget-extra-content`.
- **SWF** (`generate(ir, { widget: true })`, same generator as every SWF): the content sits inside a sprite placed on the main timeline with instance name `widget`. Text still uses imported alias fonts plus outlines (one `ImportAssets2` per font). Generated AS2 `mods.<modId>.<Swf>Widget.install(widget)` (exported class in `__Packages`, called from `frame_1/DoAction.as`) gives the clip the SkyUI contract: `setHudMetrics`, `setRootPath`, `setClientInfo`, `setModes`, `onModeChange`, `setHAnchor`, `setVAnchor`, `setPositionX`, `setPositionY`, `setAlpha`. Flash 8 AS2, no `Error` class. The AS2 follows the 0.0 spike (proven in game on SkyUI 5.2.0.0SE and 6.11) but is original code. There is no `setLabel`: a generated widget is static.
- **Scale.** Design space is 1920x1080, SkyUI's HUD space 1280x720. Both are 16:9, so one factor k = 2/3 applies: the `widget` clip is placed with scale 2/3, the SWF stage is 1280x720, and the Papyrus `X`/`Y` are the design anchor point times 2/3. The anchor point is the frame's left/centre/right (top/centre/bottom) edge from its IR `anchor`; `stretch` and `scale` anchors fall back to left/top.
- **Papyrus.** `<ModId>_<WidgetName>` extends `SKI_WidgetBase`: `OnWidgetInit` sets `WidgetName`, `HAnchor`, `VAnchor`; `GetWidgetSource` returns `<modId>/<widgetName>.swf` (relative to `Interface/exported/widgets/`); `GetWidgetType` returns the script's own name; `OnWidgetReset` calls `Parent.OnWidgetReset()` then sets `X`, `Y`, `Alpha` (percent). `<ModId>_<WidgetName>Instance extends <ModId>_<WidgetName>` is empty. Both names must be ASCII letters and digits (starting with a letter). `Debug.Trace` lines `[Inkwell] <script> OnWidgetInit` / `OnWidgetReset at x,y` go to the Papyrus log.
- **Plugin** (`esp.ts`): a hand-written, ESL-flagged ESP with master `SkyUI_SE.esp` and one start-game-enabled quest `<ModId>_<WidgetName>Quest` (form id `0x01000800`) with the Instance script attached through VMAD. The record layouts are documented at the top of `esp.ts`. Byte-identical to the 0.0 spike plugin, which loaded in game; not checked in xEdit/CK.

## SkyUI rules this relies on

- Two scripts: the widget, and an empty `...Instance` attached to the quest. SkyUI refuses a script whose name equals `GetWidgetType()`.
- SWF under `Interface/exported/widgets/<mod>/`, root clip named `widget`.
- SkyUI files are never bundled or copied. The stubs in `resources/papyrus-stubs/` are written from scratch (marked `original stub`). `HAnchor`, `VAnchor`, `X`, `Y`, `Alpha` are full properties as in the real `SKI_WidgetBase`, not `auto`: a wrong stub compiles silently into direct field stores that do nothing in game (a test checks this).

## Papyrus compiler (user-pointed)

`papyrusCompiler.ts` runs the user's [russo papyrus-compiler](https://github.com/russo-2025/papyrus-compiler) `papyrus.exe` as a separate process: `papyrus.exe compile -nocache -h resources/papyrus-stubs -i <src> -o <out>`. It is never bundled. Set the full path of `papyrus.exe` in the environment variable **`INKWELL_PAPYRUS`** (for example `$env:INKWELL_PAPYRUS = 'C:\Tools\papyrus-compiler\papyrus.exe'`). Compiler errors come back as lint issues with code `papyrus-compile-failed` (`nodeId` = script name, message `Script.psc:line:col: text`) and no `.pex`. Without the variable `compileWidget` still writes the SWF, `.psc` and plugin and warns `papyrus-skipped`; the script `yarn compile:widget` fails instead, since the widget would not run.

## Commands

- `yarn compile:widget`: compiles `samples/hud-widget` (modId `InkwellWidgetTest`, widget `Hud`, top right, outset from the corner, teal outline and green bar, text `INKWELL WIDGET TEST` in `Everywhere / Medium / 24` and a second line in `Everywhere / Bold / 18`) into `build/widget-test/` (git-ignored) and prints stage timings and lint. Needs Java, FFDec, the wrapper jar and `INKWELL_PAPYRUS`.
- `yarn deploy:widget`: copies `build/widget-test/` into `C:\Modding\MO2\mods\Inkwell Widget Test\` (override with `INKWELL_WIDGET_DEPLOY`). Never writes to the game's `Data` folder.

## Unverified

- The HUD-metrics lerp in `updatePosition` is the spike's; it was only seen at the default 16:9 metrics. Ultrawide or custom HUD metrics are untested.
- Alpha: `setAlpha` sets the clip's `_alpha`; the Papyrus `Alpha` is the frame opacity times 100.
- Output compiled by russo matches the official compiler by reading only (see the spec's 0.0 notes).
