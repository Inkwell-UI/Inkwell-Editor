# Gamepad focus graph and button prompts (0.5, SPEC-CHANGES W3, W4, W6)

Custom menus only. Spike S-A (owner, 2026-10-27): with `inputContext` menuMode the pad reaches the menu's AS2 as the runtime's `onInput` (`Up`, `Down`, `Left`, `Right`, `Accept`) followed by synthesised key events; GFx moves focus geometrically by itself and A fires onPress/onRelease of the focused clip; B (Cancel) closes the menu in the runtime. With `none` the pad does nothing.

## Data (overlay, Spec `focus` module)
- `focus: {order, overrides?: {up?, down?, left?, right?}}` on a layer. A layer with a numeric `order` is focusable. Order: by `order`, then id; the first gets focus on open. Defaults: Down/Right = next, Up/Left = previous (wrapping); an override replaces one direction. The override value `none` (Inspector: "None") makes that direction go nowhere: focus stays on the component (a list still moves its own highlight first). `none` is not a target, so it does not count as a path for the lint.
- `prompt: {action, keyboard?, xbox?, playstation?, icon?, label?}` on a frame or component instance with role `prompt`. Defaults per action and the glyph names: Spec `PROMPT_DEFAULTS`, `XBOX_GLYPHS`, `PS_GLYPHS`, `KEY_LABEL`. `icon` and `label` are the layers chosen as the icon place and the text (localize it with its translation key); see "A prompt component".

## Lint
| Code | Severity | Where |
|---|---|---|
| `focus-unreachable`, `focus-dead-end`, `focus-target-missing` | error | build (`src/shared/focusLint.ts`, Spec `focusGraph`) |
| `focus-node-missing`, `focus-direction-unknown`, `focus-not-compiled`, `focus-not-menu` | warning | build |
| `prompt-invalid`, `prompt-not-frame` | error | build |
| `prompt-layer-missing` | warning | build (the chosen icon or text layer is gone; the default is used) |
| `focus-input-context` | error | export gate and Menu settings (`menuLint`): a focus graph needs effective `inputContext` menuMode |

## Codegen (`src/main/codegen/menuGlue.ts`, `src/main/swf/promptGlyphs.ts`)
- Focus: the menu class keeps the clip paths in order and one index table per direction; `onInput` Up/Down/Left/Right sets focus on the target; `onOpen` focuses the first. The menu class keeps the current focus member itself (`curPath`, shared with the lists as `InkwellList.focusPath`) and only that member is focusable (`setCur`), because GFx's own geometric focus moves still ran after the pad's key events in the first game test (traces 2026-11-04); each press first puts GFx's focus back on the current member. `begin()` sets `Selection.disableFocusKeys = true` so GFx's own arrow navigation does not move focus a second time (unverified in game). Accept is GFx's own press of the focused clip; the generated code adds nothing for it.
- Lists: in a menu with a focus graph a list frame is one member (give it an order). It reacts to Up/Down/PageUp/PageDown/Accept only while it has focus (`InkwellList.input(action, true)`); Up on the first item, Down on the last item, Left and Right return false and go to the focus graph (`moveFocus`). `InkwellList.sync()` runs after every move: only the focused list shows its highlight (others dim), and a list gaining focus with no highlight highlights its first item. Menus without a graph keep the old behaviour (the active list always reacts). Not run in game.
- Prompts: three clips per prompt (`glyph_keyboard`, `glyph_xbox`, `glyph_playstation`) are compiled from synthetic layers added to the build's copy of the IR (never saved; their lint is reported on the prompt). The menu class shows the keyboard clip, then the one of `getInputDevice()` (polled every 250 ms and on every input). Pad style: mod INI `[Prompts] Gamepad=xbox|playstation` (default xbox).
- Golden AS2 and the FFDec compile of `samples/menu-gamepad`: `src/main/lint/focus.test.ts`, `focus.integration.test.ts`.

## Editor
- Stage toolbar **Focus Graph** (custom menus): badges with the position in the order (red with a focus error), one arrow per override. Inspect mode: click a component to add it (the nearest frame), Alt+click to remove, drag from one component to another to set the override of the drag direction.
- Inspector **Focus** card (custom menus): Order and one row per direction (Up, Down, Left, Right) as a label and a dropdown, Remove as the card title action (an unset direction is dim and names its default target). **Prompt** fields for role `prompt`: action, glyph per device.
- Stage toolbar **Prompts: Keyboard / Xbox / PlayStation**: sets the mock device and pad style and reopens the menu in the preview.
- Play mode in a menu with a focus graph: arrow keys and Enter go to the menu as the d-pad and A (`inkwellPad` in the preview SWF), not to Ruffle.

## In game
`yarn deploy:menu-gamepad` builds `samples/menu-gamepad` (4 buttons, overrides that break the geometry, an Accept and a Cancel prompt, hotkey F10) into `C:\Modding\MO2\mods\Inkwell Menu Gamepad Test` with the runtime DLL (`--to`, `--dll`, `--dev` as the other menu deploys). Steps: `TEST-IN-GAME-0.5.md`, Phase 3 checks.

## For modders: the rules in one place (0.5, tested on Skyrim SE 1.7.104 with an Xbox-type pad)
- **Input context.** A custom menu only gets pad input when its **Input Context** is `menuMode` (Menu tab; modal menus default to it). With `none` the d-pad does nothing. A focus graph needs `menuMode` (lint `focus-input-context`).
- **What the pad does.** D-pad and A reach the menu as `On Input` (`Up`, `Down`, `Left`, `Right`, `Accept`); the focus graph moves focus. **B (Cancel) closes the menu** and cannot be changed in 0.5 (close-only). The left stick was not tested (the owner's run reported d-pad and buttons only).
- **Which device.** The runtime reports `keyboardMouse` or `gamepad` and switches live while the menu is open. It does **not** say Xbox or PlayStation, so the glyph style is the player's choice in the mod's INI (`SKSE\Plugins\Inkwell\<modId>.ini`):
  ```
  [Prompts]
  Gamepad=xbox
  ```
  `xbox` is the default; `playstation` shows the PlayStation set. The editor's stage toolbar **Prompts** switch only changes the preview.
- **Menu replacements** (docs/contracts.md) use the game's own pad navigation: it reaches a replacement with no extra work (tested with no SkyUI, SkyUI 5.2 and SkyUI 6.11).
- **Not tested:** AE (expected to work), a PlayStation pad itself (the glyphs were checked only as drawings via the INI; the runtime cannot tell the pad type).

## Marking a prompt (Inspector, Behaviour tab)
A prompt is a layer (a frame, or a Figma instance) with the role **Prompt**; there is no lookup through components, so each prompt layer carries its own settings. The **Prompt** card then shows:
- **Action** (Accept, Cancel, ...), and **Shows**: the keyboard, Xbox and PlayStation glyph in one row (the action's defaults are shown dim; choose one to override).
- **Icon**: which child of the prompt marks where the glyph goes (its position and height are used; it stays in the prompt's auto layout, transparent, so the text keeps its place). Only the prompt's own children are offered. Without a choice, a child named `promptIcon` is used, else the glyph is as tall as the prompt at its top left.
- **Text** (optional): which child is the label; without a choice, the first text layer. Localize it with its translation key. Without any text layer the drawn key caps use the default text font (the real Skyrim art needs no font).
- A chosen layer that no longer exists is the warning `prompt-layer-missing`; the default is used.

## The game's own prompt art (S-H to S-M, `archive/TEST-IN-GAME-0.5.md`; seen in game: keyboard keycaps, SE 1.7.104)
A prompt shows Skyrim's own button sprites (`360_A`, `PS3_A`, `Enter`, `Esc`, ...). Every vanilla menu SWF exports them in its library; nothing of the game's art is shipped.
- **How:** at start the runtime (`Inkwell-Runtime/src/plugin/VanillaAssets.cpp`) copies three vanilla files (`textentry`, `creationclubmenu`, `sharedcomponents`) from the game's own resources to `Data/Interface/Inkwell/_vanilla/` (under MO2 they land in `overwrite`). The menu class (`loadArt` in `menuGlue.ts`) loads `../_vanilla/<file>.swf` into each glyph clip and `attachMovie`s the sprite. The sprite map is `src/main/swf/promptArt.ts` (names only). A load or sprite that fails keeps the compiled glyph below.
- **Why the copy:** a path with `..` cannot reach the game's BSA (the game keeps the URL unnormalised), a loose file can. A menu SWF directly in `Interface/` could load by plain name, but the runtime copy keeps the sub-folder layout.
- **Your Figma layout:** a layer named `promptIcon` directly inside the prompt frame gives the icon's position and height (the placeholder stays in the layout, transparent). Without it the icon is as tall as the frame, at its top left.
- **Limits:** no sprite for the D-pad or Share (the drawn glyph stays); the Ruffle preview shows the real art when the vanilla cache is built (Settings: the game's Interface BSA; see `src/main/swf/previewArt.ts`) and the compiled glyphs when it is not; AE and GOG untested; Xbox and PlayStation sprites not yet seen in game. `INKWELL_PROMPT_ART=0` builds without the real art.

### In the editor's preview
Ruffle cannot read the game's archive, so main reads the same three files from the vanilla cache (`readPreviewArt`), removes their font import tags in memory (`withoutImports`: the game's menus import fonts from `gfxfontlib.swf`, which Ruffle cannot fetch, and the movie never finished loading), and the preview window gives them to Ruffle as blob URLs in the Flash variables `inkwellArt_<file>`. The preview build of the menu class reads those instead of `../_vanilla/`; the game build never does. Nothing is exported or saved. A prompt traces `[Inkwell] prompt art: ...` for each sprite (or why it was not loaded). Debug run: `INKWELL_SHOTS_GLYPHS=1` (scratch copy of `samples/menu-gamepad`, a separate `--user-data-dir` holding a copy of `vanilla-cache`; close the Figma plugin first, it pushes its frames into any editor it finds).

## The compiled glyphs (fallback)
The glyphs are drawn from the game's own button fonts, **`ControllerButtonsInverted`** (the grey ring and the letter) over a dark disc or pill of ours. They are the game's pad font, not the coloured button textures the vanilla menus show: **a custom menu cannot draw those textures** (`img://` finds no file by those names and importing from `hudmenu.swf` makes the game refuse the whole menu; both were tried in game, S-F and S-G in `TEST-IN-GAME-0.5.md`). Xbox A B X Y, LB RB LT RT, Start and Back and PlayStation Cross Circle Square Triangle, L1 R1 L2 R2 and Options use the font; the d-pad, Share and keyboard key caps are drawn shapes. The fonts come from the player's own install (Skyrim fonts the SWF names; nothing is shipped). Seen in game: A and B with the ring (Xbox set); PlayStation and the other glyphs not yet seen in game.
- Fallback: `INKWELL_VECTOR_GLYPHS=1` builds drawn vector glyphs instead (use it if a player's game shows blank prompts).
- Colours: the font glyphs are light grey. Tinting them in the Xbox colours was not done.
