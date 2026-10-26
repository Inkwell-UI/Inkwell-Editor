# Preview fonts

The preview SWF (`compileSwf(..., { preview: true })`) draws text with the preview font (see "Why glyphs are embedded"); a device-font `DefineEditText` (`fontClass` = a font name) is only the fallback. Ruffle 0.7.1 resolves that name against fonts registered through its `fontSources` config, so each Skyrim alias face gets its own font by name (verified: Light, Medium and Bold render as three distinct faces). `defaultFonts` slots are not needed. Without any registered font the name falls back to Ruffle's built-in sans (the old look).

## Why glyphs are embedded (measured, 2026-10-23)

Device-font text is not drawn by Ruffle when the field, its group or any ancestor frame is rotated (Flash limitation, reproduced with `INKWELL_SCREENSHOT` on a scratch project: rot 0 draws; rot 30, 45, 90, -30 and a text node rotated 20 deg draw the rectangle but no text). Ancestor 50% opacity keeps drawing (dimmer). So the preview SWF uses **embedded outlines** for every face that has font bytes: a placeholder `DefineFont3` (zero glyphs, named like the face) per face, `DefineEditText` with `fontId` + `HasFont` + `UseOutlines` and no font class, and the compile's FFDec step imports the glyphs (`fonts` folder in the wrapper job: `<fontCharId>.ttf` + `<id>.txt` with the characters; the wrapper calls `FontTag.addCharacter` per character, caching the parsed font by content). Subset = printable ASCII plus every character of the text nodes using that face, so a build only carries what it draws (about 13 KB for a few fields). The TTF is copied into the build folder only (`build/preview/<swf>/fonts/`, never exported or deployed); the game SWF is unchanged. Faces without bytes (no font resolved) still fall back to a device font. `INKWELL_PREVIEW_EMBED=0` switches embedding off (device fonts) for comparison.

Cost, warm wrapper, 8 text fields: preview compile 33 ms with device fonts vs about 48 ms embedded (+15 ms); the first embedded build after the wrapper starts is slower (JIT, AWT font load; about +150 ms). Text fill alpha was not separately verifiable at preview scale; the game SWF keeps it (`textColor` alpha), see the in-game sheet section K.

## Source per face (priority)

1. **Installed Skyrim fonts**, read-only, from `%LOCALAPPDATA%\Microsoft\Windows\Fonts` (`Inkwell-Everywhere-Light|Medium|Bold.ttf`, `Inkwell-<Face>-Regular.ttf` for Handwritten, Dragon, Falmer, Dwemer, Daedric, MageScript, SkyrimSymbols, SkyrimBooks, SkyrimBooksUnreadable, ControllerButtons, ControllerButtonsInverted, `Inkwell-CreationClub-Regular|Bold.ttf`), as put there by the opt-in font tool (`docs/font-install.md`; restart Inkwell after installing). Never copied, written or committed.
2. **Bundled OFL lookalikes** in `resources/preview-fonts/` (licences and README there): Barlow Condensed Light/Regular/Bold for the Everywhere faces, Barlow Condensed Regular for the faces with no lookalike (Handwritten, SkyrimBooks, Dragon, cipher fonts, symbols, controller buttons, unreadable books, Creation Club; Bold for Creation Club Bold), Share Tech Mono for `$ConsoleFont`.

`INKWELL_PREVIEW_FONTS=auto|installed|bundled` (default `auto`) forces the source; `installed` still falls back per face when a file is missing. The alias-to-face table is `FACES` in `src/main/previewFonts.ts` (`$StartMenuFont` uses Everywhere Medium; `$DialogueFont` uses Everywhere Light, as in vanilla `fontconfig.txt`).

## Flow

`resolvePreviewFonts` (main, once) reads the files and the full name (name ID 4) of each. The pipeline passes `nameFor(alias)` and `bytesFor(name)` to the compiler (`previewFont`, `previewFontBytes` options), so the preview SWF embeds that font's glyphs and names it. The renderer fetches the bytes once through IPC `getPreviewFonts` (ArrayBuffer), makes Blob URLs and gives them to Ruffle as `fontSources`; the page CSP allows `connect-src blob:`. Font bytes appear nowhere else (not in `PreviewBuild`, not in the SWF); only the name and the badge labels travel with a build. A changed font source needs a restart.

## Glyph coverage (lint `font-missing-glyph`)

`PreviewFontSet.glyphsFor(alias)` returns the cmap (formats 0, 4, 12; `cmapCodePoints` in `src/main/fonts/sfnt.ts`) of the font resolved for an alias: the installed file when present, else the bundled lookalike when it is a real match (Everywhere Light/Medium/Bold). Generic stand-ins (`generic: true`: Barlow standing in for Dragon, the controller buttons, Console...) return undefined, because their characters say nothing about the game font, and the compiler skips the check. The compiler warns once per text layer that uses characters outside the set (`mapText`, `docs/swf-compiler.md`). Tests use synthetic cmaps.

## Approximated faces

`PreviewNotes.approximated` lists the faces a build uses that are drawn with a bundled lookalike; the data is still in the build (`PreviewNotes`); the on-screen badge was removed 2026-10-26. Faces drawn with installed fonts are not listed.

## Choosing the lookalikes (measured)

Compared with the installed game fonts using fontTools (average advance over a pangram plus digits, per em; cap height; line height). Everywhere Medium is Futura-Condensed-like: cap height 0.754 em, x-height 0.505 em, line height 1.19 em.

| Candidate | Avg width vs Light / Medium / Bold | Cap height | Line height |
| --- | --- | --- | --- |
| Barlow Condensed Light / Regular / Bold | +11% (Light) / +8% (Regular vs Medium) / -3% (Bold) | 0.70 em (-7%) | 1.20 em |
| Saira ExtraCondensed Light / Medium / Bold | 0% / -3% / -17% | 0.69 em | 1.57 em |
| Saira SemiCondensed | +31..41% | | |
| Share Tech Mono (Console) | monospace, 0.54 em | | |

Saira ExtraCondensed matched widths better but its tall ascent/descent made paragraph line pitch 1.3x the game's, so it was rejected; Barlow Condensed has near-identical line height and x-height, so lines and baselines land where the game puts them. Short capital-heavy strings run wider than the average suggests ("FontTest" about +20%). Oswald, League Gothic and Jost ship as variable fonts upstream and were not tried.

Flash px sizing and em sizing: Flash field size is the em size, same as the font's em, so no scaling is applied; the visible difference is cap height (-7%) and widths above. Field bounds, alignment and placement are identical to the game SWF (unit test `generate preview`).

## Refreshing

Download static TTFs and the OFL.txt from `https://raw.githubusercontent.com/google/fonts/main/ofl/<family>/`, replace the files, update the `FACES` table and this page. Do not run package installs for fonts; they are plain assets.
