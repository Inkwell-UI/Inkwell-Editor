# Localization (milestone 0.4)

Texts of a custom menu can be translated. Formats and rules: SPEC-CHANGES section V (V2 to V4) and V13 (the runtime reads the translation files itself); the pure functions are in `Inkwell-Spec/src/localization.ts`. In-game status: the spikes (`TEST-IN-GAME-0.4.md` section 6) showed that the engine's translator works in a custom menu but loads translation files only for loaded plugins, which an Inkwell mod does not have. So the runtime (0.4.0) reads `Interface/Translations/<modId>_<LANGUAGE>.txt` itself. **Verified in game by the owner (2026-10-27):** English and German in a custom menu (S-B2 and test E, `TEST-IN-GAME-0.4.md`), including the umlauts; the Stopwatch of Phase 6 runs with it. Untested: other languages, a font replacer, a game language the table lacks beyond the source fallback.

## Data

| What | Where | Rule |
| --- | --- | --- |
| Key of a text layer | overlay `locKey` (`swfs/<name>/overlay.json`) | `$` + letters, digits, `_` (at most 96). Case-insensitive like the engine. The IR keeps the Figma text, the **source language**. |
| Table | `localization.json` at the project root | Spec `Localization`: `namespace` (`Inkwell_<modId>`), `source` language, `languages`, `entries[key][LANGUAGE]`. Read and written by `src/main/project/localizationFile.ts` (stable bytes, unknown keys kept, an unreadable file is never overwritten). |
| Edits | `src/shared/localizationOps.ts` | Pure: `ensureKey`, `setCell`, `renameKey`, `removeKey`, `addLanguage`, `removeLanguage`, `mergeCsv`. |

## Inspector and Localization tab

A text layer has a **Localization key** field in the overlay section: type a key, or Suggest (`$Inkwell_<modId>_<LayerName>`, made unique). Setting a key creates its row in `localization.json` (the layer's text becomes the source cell; if the project has no table yet, one is created). Clearing the key leaves the row (the lint reports it as unused). Two layers may share a key only with the same text (`loc-key-duplicate` otherwise).

The **Localization tab** (bottom dock) lists every keyed text layer of the project, one column per language, the source first. Translation cells save as you leave them; an empty cell shows `[missing]` and that language then falls back to the source text. Buttons: Add language, Import CSV (shows what it will change and asks first; never deletes), Export CSV (UTF-8 with BOM), Export Skyrim .txt (one UTF-16 LE file per language into a folder you choose).

## Keyed Set Text in graphs (0.5)

A **Set Text** whose `text` field is a `$KEY` (the whole text, same rule as a layer key) is a keyed text too, so a graph can change a label and keep it translated (a Start/Stop button: two Set Text nodes with `$Inkwell_<modId>_Start` and `$Inkwell_<modId>_Stop`).
- **Codegen** (custom menus only): the node writes `field.text = __g.tr("$KEY")`; `tr` (a member of the menu graph class, emitted only when used) asks `bridge.translate` and shows the answer, or the key itself when the runtime has no entry. A **wired** text goes through `tr` as well and is translated at run time when it starts with `$`; any other text is shown as is. A plain literal is not wrapped. HUD widgets never translate (`loc-needs-runtime`).
- **Table:** the Localization tab lists the key with the layer column `<graph> > Set Text`; there is no Figma text, so the source cell is editable there (typing it creates the row, and the CSV export then contains it). Only an unwired Set Text literal is found; a key that reaches Set Text through a wire (Select, Format) is translated but must be added to the table by hand (Import CSV).
- **Lint:** `loc-translation-missing` warns when a graph key has no source text in the table (the runtime file then lacks it and the player sees the key), and per language like layer keys; a graph key counts as used for `loc-key-orphan`; a widget gets `loc-needs-runtime`. No `loc-source-changed` or `loc-key-duplicate` for graph keys (they have no own text).
- **Runtime:** a graph key alone puts `translations` and `minRuntime` 0.4.0 into the menu JSON, like a keyed layer.
- **Preview:** in the source language the mock bridge now answers the source text (it answered the key before), so a graph's keyed Set Text shows it; the answers are delivered after the movie starts, so a Set Text that runs before that (On Load) shows the key until the menu is reopened.

## Compile and deploy

- A keyed text compiles with its **source text**; the menu class (`menuGlue.ts`) calls `tx(field, key)` for every keyed field in `begin()`, before the graphs start: `bridge.translate(key)`; if the answer differs from the key the field shows it. No runtime, no table, no entry: the player sees the source text.
- The menu JSON gets `translations: <modId>` and `minRuntime` 0.4.0 (feature `translation`, `RUNTIME_FEATURE_SINCE`) when any text of the SWF has a key; without keys the menu stays at 0.3.0.
- Deploy and Package Mod write `Interface/Translations/<modId>_<LANGUAGE>.txt` for each language of the table. A language without a text for a key carries the source text. The files are part of the manifest like any deployed file.
- HUD widgets have no runtime: keys on a widget are ignored and the lint says `loc-needs-runtime`.

## Lint (deploy gate; also the codes of V10)

Errors: `loc-key-invalid`, `loc-key-duplicate`. Warnings: `loc-translation-missing` (per language, with the first keys), `loc-key-orphan` (a table key no layer uses), `loc-source-changed` (the Figma text differs from the source cell), `loc-needs-runtime`.

## Preview

For a custom menu the stage toolbar has a **Locale** select (the source language, or any other language of the table) and **Pseudo-Loc** (V4: accents, +35% length, wrapped in `[ ]`). They feed the mock bridge (`translate` answers from the mock data keys `tr.<$KEY>`) and reopen the menu. Only keyed texts change. Both are disabled for a HUD widget, and until the project has a `localization.json`. The preview never writes files.

## Not done yet

A key that reaches Set Text through a wire is not found for the table. The editor UI itself stays English. A font replacer, CJK and right-to-left text are untested.
