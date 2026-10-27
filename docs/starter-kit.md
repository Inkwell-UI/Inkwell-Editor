# Starter kit (milestone 0.4)

A **Figma file you build once and duplicate** for every Inkwell mod, so your designs map to Skyrim fonts without warnings, use the layer roles the generator understands, and carry two themes. Figma files are not code: this page is the structure and a checklist. Nothing here is generated or uploaded by Inkwell. Only Skyrim's own fonts are offered (embedded custom fonts are deferred past 1.0).

## 1. Fonts: see the game's fonts in Figma

Settings > **Fonts for Figma** > Install Skyrim fonts (opt-in, per user, `docs/font-install.md`). After it, Figma lists these families, and a layer set in them maps with no `font-fallback` warning:

| Figma family / style | Skyrim alias | Use it for |
| --- | --- | --- |
| Everywhere / Light | `$EverywhereFont`, `$DialogueFont` | body text, lists |
| Everywhere / Medium | `$EverywhereMediumFont`, `$StartMenuFont` | buttons, labels, headings in menus |
| Everywhere / Bold | `$EverywhereBoldFont` | titles, emphasis |
| Handwritten / Regular | `$HandwrittenFont` | notes, letters |
| Dragon, Falmer, Dwemer, Daedric, MageScript / Regular | `$<Family>Font` | in-world scripts, decoration |
| SkyrimBooks / Regular | `$SkyrimBooks` | long reading text |
| SkyrimSymbols / Regular | `$SkyrimSymbolsFont` | symbols |
| CreationClub / Regular, Bold | `$CClub_Font`, `$CClub_Font_Bold` | Creation Club look |
| ControllerButtons / Regular | `ControllerButtons` | gamepad glyphs |

Without the install, any font name works as a stand-in but gets a `font-fallback` warning (monospace becomes `$ConsoleFont`, script fonts `$HandwrittenFont`, common sans families `$EverywhereFont`). Characters the Skyrim font lacks draw as nothing: German accents work (tested); other languages are untested.

## 2. Text styles (create these in Figma)

Name a **Figma text style** `Family / Style / Size`; the trailing number is the size preset and is dropped when the alias is looked up (font-resolution rule 1). Suggested set, sizes in the 1920x1080 design pixels:

| Style name | Used for |
| --- | --- |
| `Everywhere / Bold / 48` | menu title |
| `Everywhere / Medium / 32` | section heading, big button label |
| `Everywhere / Medium / 24` | button label, list item |
| `Everywhere / Light / 24` | body text |
| `Everywhere / Light / 18` | hint, status line |
| `SkyrimBooks / Regular / 24` | long text |

Using a text style (not loose fonts) is what makes rule 1 win: the editor never has to guess.

## 3. Components and layer names (create these in Figma)

The generator reads the **layer names** and the roles you set in the editor Inspector. Use plain frames (instances and components are not compiled yet: `unsupported-node`). Keep these as ordinary frames in your kit and copy them into each design.

| Piece | Build it as | Then in the editor |
| --- | --- | --- |
| **Button** | frame `btn` (rounded rectangle shape `btn_bg`, text `btn_label`) | Role = Button on the frame, Instance name `btn`; graph: On Click |
| **Text** | text layer set in one of the text styles | for a keyed text, Localization key `$Mod_Name` |
| **List** | frame `list` holding one item-template frame `row` (shape `row_bg`, text `row_text`) | Role = List, List item template = `row`; graph: Set Items, On Item Selected |
| **Panel** | rectangle shape `panel` (one solid fill) | bind its fill to a theme variable |
| **Title** | text layer `title` | bind its colour to a theme variable |

Rules that avoid surprises:
- **Root frame = the stage** (1920x1080). Its own fill is not drawn in game.
- Layer names become instance names (`ident`: letters, digits, underscore). Two siblings with the same name get `_2`.
- Hidden layers are not compiled. Masks and blend modes are ignored (lint warns).
- Rotation is clockwise-flipped from Figma and unverified in game: avoid it.
- A list lays out its rows at runtime; build one template row, not several.

## 4. Themes (two modes)

1. Figma > **Local variables** > create a collection (any name, e.g. `Theme`) with **two or more modes**, e.g. `Vanilla` and `Nordic`. The first collection with two or more modes is the one used.
2. Add colour variables: `title`, `text`, `button`, `panel`, `accent`. Give each a value per mode.
3. Bind layers to them: **Fill > variable** (text colour, shape fill). Opacity variables are **Number, 0 to 100**.
4. The editor shows the modes in the stage toolbar and the Menu settings Default Theme dropdown; the player picks one with `Theme=<mode>` in the mod's INI.

What changes in game: opacity, visibility, text colour, the colour of a shape with exactly one solid fill and no stroke, shape and text size. Everything else (strokes, gradients, images, text size, frame size) only follows the default theme at compile time; the editor warns (`theme-binding-not-runtime`). See `docs/themes.md`.

## 5. Checklist

1. [ ] Install Skyrim fonts for Figma (Settings).
2. [ ] Create the Figma file `Inkwell Starter Kit`: one page `Kit`, one 1920x1080 frame per piece below.
3. [ ] Create the six text styles of section 2.
4. [ ] Build Button, List, Panel, Title and a body Text as in section 3, named exactly as shown.
5. [ ] Create the variable collection with two modes and bind Panel, Title, Button background and body text.
6. [ ] Publish it as a Figma library or just duplicate the file for each mod.
7. [ ] Sync one frame into the editor: **Lint** shows no `font-fallback`, no `font-unmapped`, no `theme-variable-missing`.
8. [ ] Set the roles in the Inspector (Button, List) and open the Theme toggle in the stage toolbar: both modes look right.
9. [ ] Deploy to a test MO2 mod and check in game (hotkey opens the menu; `Theme=Nordic` in the INI changes it).

## What the kit does not give you yet

Components and variants (instances are skipped), checkbox, slider and dropdown (planned 0.5), gamepad focus and button prompts (0.5), and embedded custom fonts (after 1.0). A HUD widget has no runtime: it gets the default theme only and no translations.
