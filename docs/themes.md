# Themes (milestone 0.4)

Themes come from **Figma variable collections** (SPEC-CHANGES V6, built form in V14). The plugin sends every local collection (`Swf.themes`: name, modes, variables with a value per mode) and the bindings of each layer (`bindings`: IR property path -> variable id). The editor never edits them; the themes of a menu are the modes of the collection `themedCollection` picks (the first with two or more modes).

## What a binding changes

| Key | Runtime (the INI `Theme` changes it in game) | Compile time only |
| --- | --- | --- |
| `opacity`, `visible` | yes | |
| `transform/width`, `transform/height` | shape, text | frame (its children would stretch) |
| `runs/0/fill/color` | text with a solid fill | other fills |
| `fills/0/color` | shape with exactly one solid fill and no stroke; the background of a non-root frame with exactly one solid fill | gradient, image, a stroked shape, the root frame |
| `strokes/N/color`, `fills/N/stops/M/color`, `strokes/N/stops/M/color`, `runs/0/size` | | always (a gradient stop's variable is applied with the stop's own alpha in the compile-time default and the preview) |
| `content` (a string variable bound to a text), `lineHeight`, `letterSpacing`, `strokes/N/weight`, `strokes/N/side/top\|right\|bottom\|left`, `autoLayout/spacing`, `autoLayout/padding/0..3` | | always (compile time; the INI cannot change them, use localization for text) |

**Collections.** A theme is a mode name: every collection with two or more modes contributes its mode names (Figma's order, each once), and a variable takes the mode of that name in its own collection, else that collection's first mode. A variable of a single-mode collection resolves to its only value. Several collections therefore switch together when their modes share a name; there is no independent mode per collection.

**Pinned modes.** A layer set to a specific mode in Figma (explicit variable mode) keeps it, and so do its descendants, whatever theme is applied (`Node.modes`, collection name to mode name).

**Colour alpha.** A colour variable's alpha is the paint's alpha and replaces the stored paint opacity. In game, a tinted fill (a shape or a non-root frame's background) is drawn opaque and its clip alpha is set by the INI theme together with the colour (a shape's own opacity variable is multiplied in); the alpha of a text colour variable is not changed at run time.

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

**Verified in game by the owner (2026-10-27)** with the Stopwatch of Phase 6: the INI `Theme=` switches the colours. Test T (`TEST-IN-GAME-0.4.md` section 10) is the longer checklist. A colour variable's alpha is ignored at runtime; `overlay.themable` flags are not read (every runtime-capable binding is themable); the plugin polls variables every 3 seconds because Figma has no event for them.

## A different background image per theme

Figma variables cannot hold an image, so use layers: put each theme's image on its own layer (a rectangle with the image fill, or a frame), create a Boolean variable per image in the themed collection (true in the theme it belongs to) and bind each layer's **Visible** to its variable. The INI `Theme` key then shows one and hides the others in game; the stage toolbar's theme control does the same in the preview. A layer that a theme shows is compiled even when the default theme hides it (the menu class applies the baked theme first, `GenerateOptions.theme`, so it starts hidden); a layer hidden in every theme is still not compiled (`node-hidden`). All the images are in the SWF (embedded) or deployed (dds), so each extra theme image adds its size. To ship only the default theme's layers, set **Theme layers** to *Default theme only* in Menu settings > Advanced (`menu.json` `stripThemeLayers`): the build, the preview and the deploy then hold only what the default theme shows, and the INI `Theme` key can no longer show the left-out layers (its colours and other bindings still switch). The image fill of one layer cannot change by itself.

