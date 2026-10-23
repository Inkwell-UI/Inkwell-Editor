# Spike 8: Skyrim fonts as installed fonts for Figma desktop

Status: extraction and conversion PROVEN (run on v1.7.104). Figma listing/rendering the fonts is NOT proven until the owner tests (see "Owner test").

## Run
```
cd spikes/bsa-reader && npm ci            # once (lz4js, tsx)
cd ../font-extract
..\bsa-reader\node_modules\.bin\tsx extract-fonts.ts     # writes ONLY out/ (git-ignored)
.\install-fonts.ps1 -WhatIf               # dry run; then without -WhatIf to install (per-user)
.\uninstall-fonts.ps1                     # reverses exactly the manifest (-WhatIf supported)
```
Needs FFDec (`INKWELL_FFDEC` or default path) and Python with fonttools (`INKWELL_FONT_PYTHON`, default `C:\dev\venv-fonts\Scripts\python.exe`; `-I` is used). Nothing from the game or the output is committed.

## 1. What the game contains
`Interface/fonts_en.swf` (508 KB, in `Skyrim - Interface.bsa`) holds DefineFont3 outline fonts. `fontconfig.txt` (`fontlib` lines load fonts_console, fonts_en, fonts_cclub) maps aliases:

| alias | face in fontconfig | real source (DefineFontName) | glyphs (cmap) | kind |
|---|---|---|---|---|
| `$EverywhereFont`, `$DialogueFont` | "Futura CondensedLight" Normal | Futura Condensed Light (id 5) | 206 | text |
| `$EverywhereMediumFont`, `$StartMenuFont` | "Futura Condensed" Normal | Futura Condensed Medium (id 7) | 206 | text |
| `$EverywhereBoldFont` | "Futura Condensed" Bold | Futura Condensed Bold (id 9, bold flag) | 206 | text |
| `$ConsoleFont` | "Consolas" Normal | fonts_console.swf: Microsoft Consolas subset (also an Arial subset) | 115 | text, but Microsoft's: skipped, Windows has it |
| `$HandwrittenFont`, `$HandwrittenBold` | SkyrimBooks_Handwritten_Bold | same | 189 | text (script style, Latin-1) |
| `$DragonFont` | Dragon_script | same | 54 | decorative cipher, partial letters only (no e,i,o,p,q,r,t,u,w,y) |
| `$FalmerFont`, `$MageScriptFont` | Falmer, Mage Script | same | 29, 30 | cipher, uppercase+digits |
| `$DwemerFont`, `$DaedricFont` | Dwemer, Daedric | same | 64, 54 | cipher, upper+lower Latin keys |
| `$SkyrimSymbolsFont` | SkyrimSymbols | same | 45 | symbol font (ASCII-keyed icons) |
| `$SkyrimBooks` (not in the editor list) | SkyrimBooks_Gaelic | same | 189 | text |

Medium and Bold are two separate outline sets both named "Futura Condensed" in the font tag (bold flag differs); Medium is also what `$StartMenuFont` uses. Present in the SWF but not exported by us: Controller Buttons (+inverted), CClub Eurostile (Creation Club, third party), SkyrimBooks_Unreadable.

## 2. FFDec export (`-format font:ttf -export font`) and fontTools validation
Works: every DefineFont3 becomes a TrueType (glyf) file; fontTools loads them all.
Futura: 209 glyphs, unitsPerEm 1024, hhea ascent/descent 984/-227 (Light), 992/-222 (Medium), 1014/-268 (Bold) (matches SWF values), lineGap 170 (FFDec constant), Latin basic ASCII 0x20-0x7E complete in all three.

Quality issues:
- **No kerning in the TTF** (no kern/GPOS). The SWF does hold kerning tables (100 pairs Light, 94 Medium and Bold); FFDec drops them. Figma text will be unkerned; in game kerning applies. Could be rebuilt into GPOS from the SWF XML later (not done).
- **No hinting** (no fpgm/prep/gasp). Fine for Figma; the game rasterises its own way.
- Metrics: fix-fonts.py sets typo = hhea = win ascent/descent and lineGap 0, so Figma auto line height is about 1.18 em, not the game's leading. Set line heights explicitly.
- Flash outlines are quantised (twips, 20480 em); FFDec rescales to 1024: rounding not visible at UI sizes.
- Raw FFDec output has `head` with extra bytes, a poor name table (family "Futura Condensed" for both Medium and Bold, "FFDec v.26.3.0" strings, mojibake copyright) and OS/2 v2; fix-fonts.py rewrites names and bumps OS/2 to v4.
- Subsetted to what the game uses: Futura 206 characters incl. Latin-1; no Cyrillic/CJK (those live in fonts_ru/cn/ja).

### Licence findings (plain)
- Copyright strings from the SWF DefineFontName: Futura faces: "Copyright (c) 1987, 1991, 1992, 1993 Adobe Systems Incorporated. All Rights Reserved. Futura is a registered trademark of Fundicion Tipografica Neufville S.A." Skyrim-specific fonts: "Bethesda Softworks LLC (c) 2010. All Rights Reserved". Console fonts: Monotype/Microsoft. Eurostile: empty.
- **No licence/EULA text exists** in the data: name IDs 13 and 14 are absent (FFDec writes IDs 0-8 only). fix-fonts.py writes an ID 13 note ("extracted from the user's own Skyrim install for personal design use, not redistributable").
- **fsType = 0 ("installable") on every exported file, but that is FFDec's default, not the vendor's value**: SWF fonts carry no embedding flags. It says nothing about the real licence. The gate in fix-fonts.py (refuse when bit 1 "restricted" is set; preview-print and editable are only labelled in `fonts.json`) never fires on FFDec output; it is a guard only. Real position: commercial third-party fonts (Adobe/Linotype Futura) that Bethesda embedded for the game under the Skyrim EULA. A personal copy for the owner's own design work is plausible; **redistribution (bundling, uploading, sharing) is not**. Not legal advice; the spec's licence review should confirm.
- Implication: never ship them with the editor or a mod, never put them in a committed or shared project folder, never embed them in exports; show the notice before install.

## 3. Naming scheme (implemented in fix-fonts.py; fontTools rename works)
Convention: `family/style` -> `$<Family><Style>Font`; for single-style fonts the alias is `$<Family>Font` with style Regular.

| Figma family / style | alias(es) | file |
|---|---|---|
| Everywhere / Light | `$EverywhereFont`, `$DialogueFont` | Everywhere-Light.ttf |
| Everywhere / Medium | `$EverywhereMediumFont`, `$StartMenuFont` | Everywhere-Medium.ttf |
| Everywhere / Bold | `$EverywhereBoldFont` | Everywhere-Bold.ttf |
| Dragon, Falmer, Dwemer, Daedric, MageScript, SkyrimSymbols, SkyrimBooks / Regular | `$DragonFont`, `$FalmerFont`, `$DwemerFont`, `$DaedricFont`, `$MageScriptFont`, `$SkyrimSymbolsFont`, `$SkyrimBooks` | `<Family>-Regular.ttf` |
| Handwritten / Regular | `$HandwrittenFont`, `$HandwrittenBold` (one face) | Handwritten-Regular.ttf |

Editor decision: `$EverywhereFont` is the Light face, so `Everywhere/Light` -> `$EverywhereFont` (not `Everywhere/Regular`). `$ConsoleFont` is deliberately not produced (Microsoft Consolas; map to the installed Consolas). Families have no spaces (`MageScript`) and do not reuse real names (no clash with a user-installed Futura or Arial).
Name table: ID1 "Everywhere Medium" / ID2 "Regular" / ID16 "Everywhere" / ID17 "Medium", weights 300/500/700, so legacy GDI sees three families while IDs 16/17 group them. Single-style fonts: ID1 = family. Verified by reloading the saved files with fontTools; Figma grouping is unproven.

Real text fonts: Everywhere x3, Handwritten, SkyrimBooks. Decorative cipher scripts (Latin keys render runes, partial coverage): Dragon, Falmer, Dwemer, Daedric, MageScript. Symbol font: SkyrimSymbols. Console: Microsoft system font.

## 4. Editor opt-in tool "Install Skyrim fonts for Figma"
1. Settings button; first show the notice (text in `fonts.json`) and require explicit confirm. Never automatic.
2. Extract from the user's `Skyrim - Interface.bsa` into the per-game-version cache (never the project folder), run FFDec TTF export (the resident wrapper can replace the CLI call) and the rename step (needs fontTools, or port to JS with opentype tooling).
3. List what will be installed (family/style, aliases); install per-user (HKCU, no admin) with a manifest; an uninstall button reverses it. Tell the user to restart Figma; the fonts are visible to every app of that Windows user.
4. The plugin reports `family/style` (e.g. `Everywhere/Medium`); the editor maps it to the alias above. If Figma lacks the font it shows a missing-font warning; the editor should explain and link to the tool.
5. Refuse when fsType forbids installation; keep uninstall always available.

## Owner test (nothing is installed yet)
1. `..\bsa-reader\node_modules\.bin\tsx extract-fonts.ts` (already run once; out/ is git-ignored). Inspect `out/fonts`.
2. `.\install-fonts.ps1 -WhatIf`, read it, then `.\install-fonts.ps1`. Needs Windows 10 1809+ for per-user fonts.
3. Fully quit Figma desktop (tray too) and restart.
4. In a file, create a text layer, open the font picker, search `Everywhere`: expect Light, Medium, Bold. Type "The Elder Scrolls V: Skyrim 0123456789" in each; check the weights differ.
5. Run the Inkwell plugin on a frame using Everywhere/Medium; it should report `Everywhere/Medium`. Also try Falmer (uppercase) and SkyrimSymbols.
6. Note oddities (grouping, weight order, line height, no kerning), then `.\uninstall-fonts.ps1` and restart Figma to confirm removal.

## Proven vs not
Proven: the fonts exist in fonts_en.swf; FFDec exports valid TTFs; Latin ASCII complete for Futura; fontTools rename works; install/uninstall scripts parse and dry-run correctly (uninstall dry-run tested with a fake manifest). NOT proven: Figma lists the fonts, groups them under `Everywhere`, renders expected weights; real install/uninstall (never run); the legal position.
