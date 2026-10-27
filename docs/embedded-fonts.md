# Embedded custom fonts (built in 0.4, hidden: deferred past 1.0)

**Owner decision 2026-10-27: only Skyrim's own fonts are offered for now.** The pipeline below is built and was verified in game (test E), but the Inspector's Embedded font field is hidden (`EMBEDDED_FONTS_UI = false` in `shared/fonts.ts`). A project whose overlay already has a `font` still builds with it.

A text layer of a custom menu can be drawn with a font that travels inside the SWF instead of a Skyrim font alias. Rules: SPEC-CHANGES section V5 (and V13.1); the in-game spike S-A (`TEST-IN-GAME-0.4.md` section 6) showed that a `DefineFont3` with outlines draws in a custom menu, accents included, and that a character outside the embedded set draws as an **empty box**. The editor never touches `fontconfig.txt`. **The end-to-end menu built by the editor has not been run in game yet** (test E in `TEST-IN-GAME-0.4.md` section 8).

## Project files

| What | Where | Rule |
| --- | --- | --- |
| Font file | `fonts/<hash>.ttf` | TrueType only (an OpenType file with CFF outlines is refused). The hash is the first 40 hex digits of the file's SHA-256, so the same file is stored once. Written atomically (`project/fontFiles.ts`). |
| Settings | `fonts.json` (project root, editor-owned, not the IR) | per hash: `family`, `source` (the picked file name), `charsets` (default Basic Latin and Latin-1), `extraChars`. Unknown keys survive; an unreadable file is never overwritten. |
| Choice per layer | overlay `font` of a text node (the font hash) | Wins over the four alias rules (V5.6). The IR's Figma font is kept untouched. |

**Licence of the files.** The editor copies the file into the project and nowhere else; nothing is uploaded or committed by Inkwell. The font's licence is the author's responsibility: the add-font toast says so, and the Inspector shows the font's licence flag.

## Which characters are embedded

For one SWF and one font: the characters of every layer that uses it, plus every translation of those layers' keys (all languages of `localization.json`), plus the font's charsets (`basicLatin`, `latin1`, `latinExtendedA`, `cyrillic`) and extra characters, **limited to the characters the font maps** (`fonts/embed.ts` `planFont`). FFDec imports exactly those glyph outlines into the DefineFont3 (`swf/compile.ts`, the same `fonts` job the preview always used). Text a graph writes at runtime is only safe if its characters are in a charset or the extra characters.

## Lint and the licence gate

Errors (block export): `font-license-restricted` (fsType restricted 0x2, no-subsetting 0x100 or bitmap-only 0x200), `font-subset-missing-glyph` (a layer or translation uses a character the font has no glyph for; names the layer or `$KEY in LANGUAGE`, up to eight characters), `font-file-missing` (the overlay names a font that is not in `fonts/`). Warnings: `font-license-restricted-embedding` (fsType preview and print 0x4 or editable 0x8), `font-size-large` (about 256 KB of font data, stronger text above 1 MB), `font-embedded-widget` (a HUD widget ignores the font and ships the Skyrim alias). The findings appear with the build lint (`fonts/embedBuild.ts`) at the layer.

## Inspector

A text layer's overlay section has **Embedded font**: a select of the project's fonts, **Add font file…** (TrueType dialog; the file is analysed first and a bad file is refused with a reason), and for the chosen font the licence verdict, the charset checkboxes and the extra characters (saved at once, every SWF rebuilds), the glyph count and file size. The Font section's "Resolved to" says `embedded: <family>` and the rule line "An embedded font chosen in the overlay (wins over rules 1 to 4)". The leading of a layer follows the font's own natural line height (hhea), not the 1.2 guess of the Skyrim fonts.

## Preview

The preview SWF embeds the same font (Ruffle draws it natively), so what you see is the game's glyph set, including a missing character as a box.

## Not done yet

HUD widgets (the widget compiler does not carry embedded fonts), removing a font from the project, the font card of the UX spec's Font Resolution (size estimate), a font replacer and CJK are untested, and so is kerning (the FFDec import carries no kerning).
