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
