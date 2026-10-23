# Preview fonts

The preview SWF (`compileSwf(..., { preview: true })`) draws text as device-font `DefineEditText` (`fontClass` = a font name). Ruffle 0.7.1 resolves that name against fonts registered through its `fontSources` config, so each Skyrim alias face gets its own font by name (verified: Light, Medium and Bold render as three distinct faces). `defaultFonts` slots are not needed. Without any registered font the name falls back to Ruffle's built-in sans (the old look).

## Source per face (priority)

1. **Installed Skyrim fonts**, read-only, from `%LOCALAPPDATA%\Microsoft\Windows\Fonts` (`Inkwell-Everywhere-Light|Medium|Bold.ttf`, `Inkwell-<Face>-Regular.ttf` for Handwritten, Dragon, Falmer, Dwemer, Daedric, MageScript, SkyrimSymbols), as put there by the opt-in font tool. Never copied, written or committed.
2. **Bundled OFL lookalikes** in `resources/preview-fonts/` (licences and README there): Barlow Condensed Light/Regular/Bold for the Everywhere faces, Barlow Condensed Regular for the faces with no lookalike (Handwritten, Dragon, cipher fonts, symbols), Share Tech Mono for `$ConsoleFont`.

`INKWELL_PREVIEW_FONTS=auto|installed|bundled` (default `auto`) forces the source; `installed` still falls back per face when a file is missing. The alias-to-face table is `FACES` in `src/main/previewFonts.ts` (`$StartMenuFont` and `$DialogueFont` use Everywhere Medium).

## Flow

`resolvePreviewFonts` (main, once) reads the files and the full name (name ID 4) of each. The pipeline passes `nameFor(alias)` to the compiler (`previewFont` option), so the preview SWF names that font. The renderer fetches the bytes once through IPC `getPreviewFonts` (ArrayBuffer), makes Blob URLs and gives them to Ruffle as `fontSources`; the page CSP allows `connect-src blob:`. Font bytes appear nowhere else (not in `PreviewBuild`, not in the SWF); only the name and the badge labels travel with a build. A changed font source needs a restart.

## Badge

`PreviewNotes.approximated` lists the faces a build uses that are drawn with a bundled lookalike; the badge shows them. Faces drawn with installed fonts are not listed.

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
