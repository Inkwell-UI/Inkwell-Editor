# Install Skyrim fonts for Figma (`src/main/fonts`, `src/renderer/doctor/FontsForFigma.tsx`)

Design spec, "Text, fonts, themes and localization": the optional, opt-in, local-only tool that puts the game's own fonts on the user's Windows account so Figma designs look like the game and map through font-resolution rule 2 (`family/style`) with no `font-fallback` warning. Ported from `spike/font-extract` (commit f76f607; FFDec + Python fontTools + PowerShell there, TypeScript here). It never runs by itself.

## Flow

Settings view > **Fonts for Figma** > Install Skyrim fonts... > confirmation dialog (the notice, the faces with their aliases, the target folder) > **I understand, install**:

1. `findBsa`: the Doctor's Skyrim lookup (`checkSkyrim`), so the same manual setting / Steam / GOG detection. Error `game-not-found`.
2. `Interface/fonts_en.swf` is read from `Skyrim - Interface.bsa` with the editor's BSA reader into a temp folder (`%TEMP%\inkwell-fonts-*`, always deleted afterwards; never the project, never the repo). A loose `Data\Interface\fonts_en.swf` is ignored.
3. FFDec exports every DefineFont3 as TrueType: `java -jar <ffdecDir>\ffdec-cli.jar -format font:ttf -export font <out> <swf>` with the Java and FFDec of the settings (a cold one-off run, a few seconds; the resident wrapper has no font export). Errors `ffdec-missing` (no `ffdec-cli.jar`), `export-failed`.
4. `convert.ts` (port of `fix-fonts.py`) recognises each raw file by name ID 1 plus the bold flag and rewrites it: name table (ID1 `Everywhere Medium`, ID2 `Regular`, ID4 full name, ID6 `Everywhere-Medium`, ID13 "not redistributable" note, ID16/17 `Everywhere` / `Medium`; FFDec strings dropped), OS/2 v4, weight 300/500/700/400, `fsSelection` REGULAR|USE_TYPO_METRICS, typo = hhea = win ascent/descent, line gaps 0, `head.macStyle` 0, `head` trimmed to 54 bytes, `hdmx` removed. Compared against the spike's Python output on the real files: identical except fontTools' recompiled `cmap` encoding (same mapping) and `usLastCharIndex`. Missing Everywhere faces: error `faces-missing`; a missing other face is a warning.
5. **fsType gate:** if any face has OS/2 `fsType & 0x000E` (restricted, preview & print, editable: only 0 "installable" permits a permanent install), nothing is installed (error `fstype`). The spike only refused bit 0x2. FFDec always writes 0 because SWF fonts carry no embedding flags, so the gate is a guard; the notice is what matters.
6. `install.ts`: per user only. Copies `Inkwell-<Family>-<Style>.ttf` into `%LOCALAPPDATA%\Microsoft\Windows\Fonts` and sets `HKCU\Software\Microsoft\Windows NT\CurrentVersion\Fonts` `<Family> <Style> (TrueType)` = full path, through `reg.exe` (no native module, never HKLM or `C:\Windows\Fonts`, no admin). Windows 10 1809+ (`not-windows` otherwise).

| Figma family / style | Aliases (rule 2 maps to the first) | Source in fonts_en.swf |
| --- | --- | --- |
| Everywhere / Light | `$EverywhereFont`, `$DialogueFont` | Futura CondensedLight |
| Everywhere / Medium | `$EverywhereMediumFont`, `$StartMenuFont` | Futura Condensed |
| Everywhere / Bold | `$EverywhereBoldFont` | Futura Condensed, bold flag |
| Dragon, Handwritten, Falmer, Dwemer, Daedric, MageScript, SkyrimSymbols / Regular | `$<Family>Font` (Handwritten also `$HandwrittenBold`) | same names |
| SkyrimBooks / Regular | `$SkyrimBooks` (no `Font` suffix) | SkyrimBooks_Gaelic |

Not installed: Consolas (`$ConsoleFont`, Microsoft's, Windows has it), controller-button, CClub and SkyrimBooks_Unreadable fonts. The table is `FIGMA_FACES` in `src/shared/fonts.ts`; the preview reads the same file names (`docs/preview-fonts.md`).

## Manifest and Remove

`%LOCALAPPDATA%\Inkwell\skyrim-fonts-manifest.json` (per Windows user, like the fonts): `{ version: 1, installedAt, fonts: [{ family, style, file, regName, sha256 }] }`, rewritten after every copied file, before its registry value is set.

- **Never overwrites:** before anything is written, an existing target file or registry value of the same name (a font Inkwell did not install) refuses the whole install (`foreign`), and files are created with `wx`. A second install while the manifest lists fonts is refused (`already-installed`).
- **Failure midway:** what was done is reversed at once.
- **Remove** reverses exactly the manifest: the registry value only while it still points at Inkwell's file, the file only while its sha256 still matches. Anything else is left alone with a warning. A file that cannot be deleted (Figma has it open) stays in the manifest; Remove again after closing Figma.
- The spike's `install-fonts.ps1` wrote `{ installed: [{ file, regName }] }` at the same path; it is read as a manifest without hashes, so Remove also cleans up a spike install.

After install or remove: fully quit Figma (tray too) and restart it; restart Inkwell for the preview to pick up the installed fonts.

## Licence position (not legal advice)

The fonts are Bethesda's and, for Futura Condensed, Adobe/Linotype/Neufville's, embedded in the game under the Skyrim EULA. A personal copy for the owner's own design work is plausible; redistribution is not. So: the notice is shown in the section and again in the confirmation dialog, nothing is ever written into a project, the repo, a build or a deploy, and nothing extracted is committed. Extraction keeps no kerning (FFDec drops the SWF's kerning tables) and no hinting.

## UI

`FontsForFigma` (Settings view, under the checks; the Settings search matches its text and face names): intro, the notice (info banner), the kerning note, status (installed faces, missing files marked, folder and manifest paths), progress (`fonts:progress`: game, export, convert, install n/m, remove n/m), errors with a headline per code (`strings.fonts.errors`) plus main's detail, warnings. Install is disabled with a reason when installed, busy or not on Windows; Remove when nothing is installed. Strings in `strings.fonts`.

IPC: `getFontStatus`, `installFonts`, `removeFonts` (never reject; `FontToolResult`), `onFontProgress`.

## Tests and debug

`src/main/fonts/fonts.test.ts`: synthetic TTFs built in the test (FFDec-shaped tables, no glyph data, nothing from the game), a synthetic BSA, an injected FFDec export, a temp fonts folder and an in-memory registry: sfnt round trip and checksum, naming and rule-2 mapping of every face, metric rewrite, fsType 2/4/8 refused and 0x100 allowed, manifest write and exact reversal, refusal to overwrite a foreign file or registry value, rollback, repointed value or changed file left alone, spike manifest adoption, every error code.

`INKWELL_FONTS_SANDBOX=<dir>` swaps the real font system for `<dir>\Fonts` plus `<dir>\registry.json`. `INKWELL_SHOTS_FONTS=1 INKWELL_SHOTS_DIR=<dir>` (needs the sandbox, refuses without it; separate `--user-data-dir`) opens the section and takes `f1-fonts`, `f2-fonts-confirm`, `f3-fonts-installed` (or `f3-fonts-error`), `f4-fonts-removed`; it runs the real extraction from the detected game into the sandbox. Delete the sandbox afterwards: it holds the game's fonts while installed.

## Not verified

- A real install and Remove on HKCU and `%LOCALAPPDATA%` by this code (the sandbox run did the real extraction, conversion and the manifest steps; `reg query` was exercised read-only).
- Figma listing the fonts, grouping Light/Medium/Bold under `Everywhere`, and the plugin reporting `Everywhere/Medium`.
- Windows picking up a font without a sign-out: no `WM_FONTCHANGE` broadcast is sent; Figma needs a restart anyway.
