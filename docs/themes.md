# Themes (milestone 0.4)

Themes come from **Figma variable collections** (SPEC-CHANGES V6, built form in V14). The plugin sends every local collection (`Swf.themes`: name, modes, variables with a value per mode) and the bindings of each layer (`bindings`: IR property path -> variable id). The editor never edits them; the themes of a menu are the modes of the collection `themedCollection` picks (the first with two or more modes).

## What a binding changes

| Key | Runtime (the INI `Theme` changes it in game) | Compile time only |
| --- | --- | --- |
| `opacity`, `visible` | yes | |
| `transform/width`, `transform/height` | shape, text | frame (its children would stretch) |
| `runs/0/fill/color` | text with a solid fill | other fills |
| `fills/0/color` | shape with exactly one solid fill and no stroke; the background of a non-root frame with exactly one solid fill | gradient, image, a stroked shape, the root frame |
| `strokes/N/color`, `runs/0/size` | | always |

One rule, `shared/theme.ts` `bindingMode`, drives the lint, the Inspector chips and the codegen. Keys the toolchain does not know are kept and ignored.

## Default theme and the INI

- The **default theme** is the menu's Default Theme (Menu settings dropdown, `menu.json` `userDefaults.theme`, also written to the default INI as `Theme=`), else the first mode. It is **baked into the SWF** (`applyTheme` before the compile), so a menu with no runtime theming looks as designed. A HUD widget only ever gets this.
- The generated menu class carries one table per mode for the runtime bindings and `applyTheme(bridge.theme)` runs in `begin()`: the player's INI `Theme=<mode>` wins. **An empty name keeps the baked theme; an unknown name logs `[Theme] unknown theme 'X', keeping the default` and changes nothing.** The theme is read once when the menu opens: no switching while it is open.
- Shapes are only reachable from AS2 inside a sprite, so a themed shape (and the `fill` background of a themed frame) is wrapped in one.

## Editor

- **Stage toolbar > Preview settings:** theme, language, UI scale and Pseudo-Loc sit in one panel behind a button that shows the current "theme · language" (the compact toolbar keeps them in its More panel). The Theme select lists the modes and rebuilds the preview SWF with that mode (the game SWF keeps the default). Not saved. Occupied HUD, Focus Graph and Prompts (disabled until 0.5 or later) sit in the "..." panel at the right.
- **Inspector > Theme bindings:** the layer's bindings with the variable name and a `runtime` or `compile-time only` chip.
- **Menu settings > Default Theme:** a dropdown of the modes (a text field when the SWF has no collection).
- **Lint:** `theme-default-unknown` (error), `theme-variable-missing` (warning), `theme-binding-not-runtime` (warning, custom menus only).

## Not done / not verified

The runtime table has not run in Skyrim yet (test in `TEST-IN-GAME-0.4.md` section 10). A colour variable's alpha is ignored at runtime; `overlay.themable` flags are not read (every runtime-capable binding is themable); the plugin polls variables every 3 seconds because Figma has no event for them.
