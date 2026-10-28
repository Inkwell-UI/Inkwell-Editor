# Gamepad focus graph and button prompts (0.5, SPEC-CHANGES W3, W4, W6)

Custom menus only. Spike S-A (owner, 2026-10-27): with `inputContext` menuMode the pad reaches the menu's AS2 as the runtime's `onInput` (`Up`, `Down`, `Left`, `Right`, `Accept`) followed by synthesised key events; GFx moves focus geometrically by itself and A fires onPress/onRelease of the focused clip; B (Cancel) closes the menu in the runtime. With `none` the pad does nothing.

## Data (overlay, Spec `focus` module)
- `focus: {order, overrides?: {up?, down?, left?, right?}}` on a layer. A layer with a numeric `order` is focusable. Order: by `order`, then id; the first gets focus on open. Defaults: Down/Right = next, Up/Left = previous (wrapping); an override replaces one direction.
- `prompt: {action, keyboard?, xbox?, playstation?}` on a frame with role `prompt`. Defaults per action and the glyph names: Spec `PROMPT_DEFAULTS`, `XBOX_GLYPHS`, `PS_GLYPHS`, `KEY_LABEL`. The label is the frame's text layer (localize it with its translation key).

## Lint
| Code | Severity | Where |
|---|---|---|
| `focus-unreachable`, `focus-dead-end`, `focus-target-missing` | error | build (`src/main/lint/focus.ts`, Spec `focusGraph`) |
| `focus-node-missing`, `focus-direction-unknown`, `focus-not-compiled`, `focus-not-menu` | warning | build |
| `prompt-invalid`, `prompt-not-frame`, `prompt-no-label` | error | build |
| `focus-input-context` | error | export gate and Menu settings (`menuLint`): a focus graph needs effective `inputContext` menuMode |

## Codegen (`src/main/codegen/menuGlue.ts`, `src/main/swf/promptGlyphs.ts`)
- Focus: the menu class keeps the clip paths in order and one index table per direction; `onInput` Up/Down/Left/Right sets focus on the target; `onOpen` focuses the first. `begin()` sets `Selection.disableFocusKeys = true` so GFx's own arrow navigation does not move focus a second time (unverified in game). Accept is GFx's own press of the focused clip; the generated code adds nothing for it.
- Prompts: three clips per prompt (`glyph_keyboard`, `glyph_xbox`, `glyph_playstation`) are compiled from synthetic layers added to the build's copy of the IR (never saved; their lint is reported on the prompt). The menu class shows the keyboard clip, then the one of `getInputDevice()` (polled every 250 ms and on every input). Pad style: mod INI `[Prompts] Gamepad=xbox|playstation` (default xbox).
- Golden AS2 and the FFDec compile of `samples/menu-gamepad`: `src/main/lint/focus.test.ts`, `focus.integration.test.ts`.

## Editor
- Stage toolbar **Focus Graph** (custom menus): badges with the position in the order (red with a focus error), one arrow per override. Inspect mode: click a component to add it (the nearest frame), Alt+click to remove, drag from one component to another to set the override of the drag direction.
- Inspector **Gamepad focus** (custom menus): order, the four overrides (the default target is named), Remove. **Prompt** fields for role `prompt`: action, glyph per device.
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

## The prompt glyphs
The glyphs are drawn from the game's own button fonts, **`ControllerButtonsInverted`** (the grey ring and the letter) over a dark disc or pill of ours. They are the game's pad font, not the coloured button textures the vanilla menus show: **a custom menu cannot draw those textures** (`img://` finds no file by those names and importing from `hudmenu.swf` makes the game refuse the whole menu; both were tried in game, S-F and S-G in `TEST-IN-GAME-0.5.md`). Xbox A B X Y, LB RB LT RT, Start and Back and PlayStation Cross Circle Square Triangle, L1 R1 L2 R2 and Options use the font; the d-pad, Share and keyboard key caps are drawn shapes. The fonts come from the player's own install (Skyrim fonts the SWF names; nothing is shipped). Seen in game: A and B with the ring (Xbox set); PlayStation and the other glyphs not yet seen in game.
- Fallback: `INKWELL_VECTOR_GLYPHS=1` builds drawn vector glyphs instead (use it if a player's game shows blank prompts).
- Colours: the font glyphs are light grey. Tinting them in the Xbox colours was not done.
