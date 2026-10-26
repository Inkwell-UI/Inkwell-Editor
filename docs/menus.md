# Custom menus (milestone 0.3, Phase 3)

The `customMenu` target: a SWF that the Inkwell Runtime opens in game (hotkey, Papyrus call, mod event) instead of a HUD widget that SkyUI loads. Formats and rules are SPEC-CHANGES section S (S1 menu JSON, S2 INI, S4 bridge, S7 events and glue, S9 editor); the schemas are `Inkwell-Spec/src/menu.ts`, `ini.ts` and `runtime.ts`. The runtime itself is a separate repo and mod; nothing here was run in Skyrim. What was not verified in game is marked **(unverified)**.

## The target

The target is per SWF (`ir.target.kind`: `hudWidget`, `customMenu`, `menuReplacement`), not a project kind: a project may hold both. Figma sets it (the IR is never edited here); the Target pill in the top bar shows it and, for a `customMenu`, opens the Menu settings in a dialog. Menu-only controls on another target are disabled with a reason ("Menu settings are for custom menus").

## `swfs/<name>/menu.json` (Menu settings panel)

`MenuSettings` of the Spec: `flags` (`pausesGame`, `cursor`, `modal`, `closeOnEscape`), `inputContext` (`none`, `menuMode`; absent = `menuMode` if modal), `depth` (0 to 15), `triggers` (`hotkey` scan code 2 to 255, `papyrus`, `modEvent`), optional `name` and `swf` overrides, and `userDefaults` (`uiScale`, `offsetX`, `offsetY`, `theme`) which only ever go to the INI. `src/main/project/menuFile.ts`: stable bytes (sorted keys, 2-space indent, newline: the same `stableStringify` as every project file), unknown keys survive at every level (the schema is loose), `loadProject` reads it (`Project.swfs[x].menu`), `saveProject` writes it back only when the project holds one and it was readable. A menu.json that exists but cannot be read is shown in the panel (`menuError`), never overwritten and a deploy gate error `menu-file-invalid`. Reading a hand-written file that lacks defaults materialises them on the next save (flags and depth default values appear); a file the editor wrote round-trips byte for byte (test).

IPC `saveMenuSettings(swf, settings)` validates with `MenuSettings` and writes under the project lock; main keeps the saved copy for deploy and pushes the project (so the panel and the Lint-free export checks follow). No undo entry (menu.json is not part of the SWF's overlay/graph history yet).

**Menu settings panel** (`panels/MenuSettingsPanel.tsx`, the form is `menu/MenuSettingsForm.tsx`, also shown by the Target pill's dialog). A tab in the left group of Layout and Behaviour (disabled with a reason unless the active SWF is a custom menu). Author column (flags, Close on Esc, Input Context, Menu Depth, Open triggers: Papyrus API, SKSE Mod Event with its name; the read-only menu name and the computed "Requires Inkwell Runtime 0.3.0") and end-user column (Default Open Key as a scan-code picker plus a number box, the Gamepad combo **disabled: "planned 0.5 (not in 0.3)"**, Default Theme, UI Scale 0.50 to 2.00, Offset X/Y, a note that Dev Mode is a Dev-deploy option). Every edit is validated with the Spec schema and saved at once; an invalid number stays on screen with its message and is not saved (Escape restores it). The bottom list shows the export-gate rows of this menu and of the project (`menuLint`).

## Generated files (`src/shared/menu.ts`, pure)

| What | Rule |
| --- | --- |
| Menu name | `settings.name`, else `<modId>_<Swf>`; `<Swf>` = the SWF folder name made of letters, digits and `_`, first letter capital (`menuSwfName`: `main-menu` becomes `Main_menu`, nothing hostile reaches a path) |
| SWF path | `settings.swf`, else `menuSwfPath(modId, Swf)` = `Interface/Inkwell/<modId>/<Swf>.swf`. **O2, unverified in game** (does `LoadMovieEx` take a sub-path?). `menuSwfPath` in `shared/menu.ts` is the single place to change; the fallback in S9 is `Interface/<modId>_<Swf>.swf` |
| `minRuntime` | `minRuntimeOf` = `0.3.0` (the first runtime) |
| Menu JSON | `buildMenuDef`: the Spec `MenuDef` schema (`safeParse`), `specVersion` 6, the effective `inputContext` written out, no `userDefaults`; deployed as `SKSE/Plugins/Inkwell/menus/<menuName>.json` with the same stable bytes |
| Default INI | `modIniText` = the Spec `writeDefaultModIni` (commented keys, the author hotkey shown as `;OpenKey=`, a user default that differs from the built-in one uncommented) for every non-orphaned menu of the project, deployed as `SKSE/Plugins/Inkwell/<modId>.ini` |

## Deploy and Package Mod

`docs/deploy.md`. The INI is **created if absent and never overwritten or retired** (S9): the file entry is `createOnly`, it is not in `.inkwell-deploy.json`, a redeploy reports it as `preserved`. The Package Mod zip contains it (a fresh install has none) and never `Inkwell.ini`. The deploy dialog says "Requires Inkwell Runtime 0.3.0 or newer; not included in this deploy." The runtime DLL and `Inkwell_API.pex` are never written by the editor. A previous flat deploy (`Interface/<name>.swf`) is retired through its manifest like any file this deploy no longer produces.

## Lint and the export gate

| Code | Severity | Where |
| --- | --- | --- |
| `menu-name-invalid` | error | `buildMenuDef`: the derived or given name does not match the Spec `MENU_NAME` |
| `menu-name-duplicate` | error | two menus of the project with the same name (ignoring case) |
| `menu-hotkey-invalid` | error | hotkey outside 2 to 255 (the schema already refuses such a file; this guards values built in code) |
| `menu-event-invalid` | error | mod event name not matching the Spec `MOD_EVENT_NAME` (an editor addition to the S9 list, same rule as the schema) |
| `menu-limit` | warning above `MENU_WARN_THRESHOLD` (4), error above `MENU_SLOTS` (16) | project-wide, counted over every non-orphaned custom menu even in a one-SWF deploy |
| `menu-file-invalid` | error | menu.json exists but is unreadable |
| `runtime-required` | warning | a graph node that needs the runtime (the node's `requiresRuntime`, or one of the Spec's `RUNTIME_ONLY_EVENTS` / `GAME_BRIDGE_NODES` titles, because the bundled core pack copy predates the flag) in a **hudWidget** graph; also a `saved` variable in a HUD widget. `validateGraph(g, {target})`, so the Lint dock, the canvas badges and the export gate agree |
| `saved-variable-invalid` | error | a `saved` variable outside the menu graph of a custom menu, or a name used twice in the SWF |
| `runtime-check-missing` | not implemented | needs the generated no-master ESP and Papyrus check (S3 rule 3, O4): Phase 7 |

`menu-*` rows are deploy/Package gate rows and the panel's list; they are not in the Lint dock (the dock shows the sync builds' lint and the graph issues). `runtime-required` and `saved-variable-invalid` are graph issues and are in the dock.

## The AS2 menu glue (S7)

`src/main/codegen/menuGlue.ts` (pure text) and the `menu` flavour of `codegen.ts`; `swf/generate.ts` wires them for `ir.target.kind === 'customMenu'` (the game SWF and the Ruffle preview alike; a `customMenu` always gets the glue, with zero graphs too, because the runtime waits for `glueReady()`).

**Frame code** (after the clips and classes exist): `_root.inkwellMenu = new mods.<modId>.<Swf>Menu(this); _root.inkwellMenu.start();`. The graph instances are no longer created by the frame code; the menu class does it.

**The class** `mods.<modId>.<Swf>Menu` (`<Swf>` = the SWF class stem, the same as the graph classes: `Hud` for `hud`, `Menu` for `menu`, so `MenuMenu` for a SWF called `menu`):

| Member | Does |
| --- | --- |
| `start()` | S4.2 retry rule: if `_root.inkwell.ready` is true, begin; else `setInterval` every `BRIDGE_POLL_MS` (50) up to `BRIDGE_POLL_MAX` (100) polls (5 s), then trace `inkwell bridge missing` and begin with a local stub (every `BRIDGE_MEMBERS` member a no-op, `getSaved` returns its default, `ready` false) |
| `begin(bridge)` | applies `uiScale` / `offsetX` / `offsetY` to `_root` only when they differ from the defaults (S9 formula, 1920x1080 reference; **unverified** in the game's GFx); makes the role `button` and `list` layers `tabEnabled` (see below); creates each graph class (`new ...(base)`, `g.bridge = bridge`, `base.inkwellGraphN = g`, `init()` inside try/catch that `fail`s the graph), then `bridge.glueReady()` |
| `onOpen()`, `onClose()` | call each graph's `onOpen` / `onClose` member (set by the On Open / On Close templates) |
| `onInput(action)` | `graph.handleInput(action)` (the On Input templates register with `addInputHandler`) |
| `onMessage(name, text, number, flag)`, `onModEvent(name, strArg, numArg)` | `graph.handleMessage` / `handleModEvent` (Phase 5 templates register with `addMessageHandler` / `addModEventHandler`; the registries exist now) |
| `dumpVariables()` | empty until the dev stream (Phase 6) |

**What the glue wires and what it does not.** S7 says component events register themselves in `init()` "as in 0.2 and need no runtime call", and codegen proves it: the On Click template is `target.onRelease = function() {...}`, On Focus / On Blur are `onSetFocus` / `onKillFocus`, On Value Changed and On Item Selected are `addEventListener("change"/"itemClick", ...)` on the target. The glue therefore does not re-wire clicks (that would fire a handler twice). What it adds from the overlay roles is focusability: a clip with role `button` or `list` gets `tabEnabled = true`, so that Tab/arrow focus and the focus events can reach it **(unverified in GFx)**; paths come from the compile (`GenerateOptions.roles`, filled from the overlay by the build pipeline). On Value Changed and On Item Selected need the list component (Phase 5).

**The menu flavour of a graph class** (`CodegenInput.menu`; a HUD widget's classes are byte-identical to before, golden test): `var bridge`, `log(level, nodeId, text)` (bridge `log` when the bridge is ready, else `trace` of the same `[Inkwell] <level> <node>: <text>` line), `fail` goes through `log`, the Log node's line `trace("[Inkwell] <level> <id>: " + msg)` is rewritten by codegen to `__g.log("<level>", "<id>", msg)` (so the runtime gets the node id without a Core-Pack template change: `toBridgeLog`), and `addMessageHandler` / `handleMessage` / `addModEventHandler` / `handleModEvent`. **No Core-Pack template was changed.**

Order on open (S7): the runtime installs `_root.inkwell` (ready) -> frame code starts the menu class -> graphs `init()` (On Load at its end) -> `glueReady()` -> the runtime replays data and calls `onOpen()`.

## The Ruffle preview (mock runtime)

Only the preview SWF (`preview: true`) gets `_root.inkwell` (`previewMenuBridge` in `swf/generate.ts`): every `BRIDGE_MEMBERS` member, `ready: true`, `version` 196608, `log` traces the line the Trace panel parses, `glueReady()` calls `_root.inkwellMenu.onOpen()` (the runtime's next step, so the preview shows an open menu), `getSaved`/`setSaved` keep a map for the session, everything else answers its default. ExternalInterface callbacks for the Play panel: `inkwellMenuOpen`, `inkwellMenuClose` (call the menu class like the runtime), `inkwellClick(nodeId)` (calls `onRelease` of a role-`button` layer; `_global.Inkwell.paths` maps node ids to clip paths). The Play tab of a custom menu shows Open, Close and a Component picker with Click (`docs/debugging.md`). A real mouse click in the preview's Play mode (not Inspect) reaches the same handler. The preview does not recreate the movie on Close/Open (the engine does in game, so menu variables restart there); the Reload button restarts it. The preview toolbar's UI Scale control is Phase 7 (not built); `begin()` already honours a non-default `uiScale` from the bridge.

## Sample

`samples/menu-slice`: a customMenu SWF `menu` (title, button `btn`, status text `status`), menu.json (K hotkey, mod event `InkwellMenuTest_Open`, modal, cursor, pauses), graph `On Click(btn) -> Set Text(status, "Button clicked!") -> Log`. Mod id `InkwellMenuTest` (the Phase 4 mod folder name `Inkwell Menu Test`). Fonts are the alias fonts (`Everywhere / Medium`); no binaries.

## Tests and drivers

- `codegen/menuGlue.test.ts`: golden AS2 of the menu class and of a menu-flavoured graph class, the retry numbers, the stub members, the frame code, the preview bridge, HUD output unchanged, `samples/menu-slice` lint.
- `codegen/menuGlue.integration.test.ts`: the real FFDec compiles the sample as game SWF, preview SWF and without graphs (the AS2 parses; FFDec's AS2 parser rejects quoted keys in object literals, which the first draft of the preview bridge used).
- `shared/menu.test.ts`, `project/menuFile.test.ts` (golden bytes, round trip, unknown keys, broken file), `deploy/plan.test.ts`, `run.test.ts`, `service.test.ts` (layout, JSON, INI never overwritten, gate rows, zip), `shared/graphValidate.test.ts`, `workspace/panelRegistry.test.ts`.
- `INKWELL_SHOTS_MENU=1` `INKWELL_SHOTS_DIR=<dir>` `INKWELL_SHOTS_PROJECT=<scratch copy of samples/menu-slice>` (optional `INKWELL_MO2_MODS=<scratch folder>` for a real deploy): `src/main/screenshotMenu.ts`, the pattern of `screenshotPopup.ts`. Run `yarn build` first, then `electron . --user-data-dir=<scratch>` with `ELECTRON_RUN_AS_NODE` unset. It checks in the real Ruffle preview: the mock bridge is ready and the menu class started; the Play panel's Click changes the status text and the Log line reaches the Trace panel with its node id; Close/Open; a real mouse click does the same; the Menu panel and its edits land in menu.json (an invalid scale is refused); the dialog; and a real deploy. States `m0-start` to `m7-menu-dialog`.

## Not done here (later phases, S-numbers)

Papyrus runtime check ESP (S3, Phase 7); dev stream, `dumpVariables`, `watch`/`pin` emission and Dev deploy (S6, Phase 6); saved variable codegen (S5), list component and the Game bridge / runtime event nodes (S8, Phase 5); the preview's UI Scale control (S9, Phase 7); menu.json in the SWF's undo history; renaming a Figma frame moves its folder in the build pipeline without carrying menu.json along (the pipeline's rename path only keeps ir.json and overlay.json; not checked for graph files).
