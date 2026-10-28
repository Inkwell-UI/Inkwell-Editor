# Play area (removed, to be reworked)

The Play tab of the bottom dock (panel id `play`, `src/renderer/panels/PlayPanel.tsx`) was removed on 2026-10-28 because it needs a complete rework. This lists what it did, so the rework can cover it. The old code is in git history (`PlayPanel.tsx`, `model/playEntries.ts` and its test).

Not related: the stage toolbar's Interact mode (`StageMode 'play'`, `mode-play`) stays.

## What it did

Everything went through `previewBus.call(<callback>, ...)` into the running Ruffle preview. Nothing worked without a running preview (disabled with "the preview is not running in this window").

**Custom menu SWFs only**
- Open, Close: `inkwellMenuOpen`, `inkwellMenuClose` call the menu class's `onOpen` / `onClose`, as the runtime does.
- Reopen: `inkwellMenuReopen` closes and reopens with a fresh menu class and fresh graphs (saved variables stay, clip texts are not reset).
- Click: pick a layer with role Button, `inkwellClick(nodeId)` calls its `onRelease`. Disabled text when no layer had the role.
- UI scale slider: `inkwellUiScale` (also in the stage toolbar, which stays).
- Send input: pick one of the Spec's `INPUT_ACTIONS` (Down, Up, Accept...), `inkwellInput(action)` forwards it as the user event (On Input, and the list).
- Send mod event: name, string, number, `inkwellModEvent` (On Mod Event). Needed a name.
- Send runtime message: name, string, number, flag, `inkwellMessage` (On Runtime Message).
- A one-line result with time ("Called onOpen...", or "the preview did not take it").

**Any SWF with an On Widget Call node** (HUD widgets too)
- Entry picker listing each On Widget Call as `Name(params) - graph`, kept current while graphs are edited (`playEntries`).
- Typed parameter fields (String, Number, Bool), all passed to the movie as one string array (`callArgs`; Number falls back to `0`, Bool to `false`), `inkwellCall(name, args)`.
- The chosen entry and typed values were remembered for the window's lifetime.
- Result line with time, or "no such method (rebuild pending, or the graph did not compile)".

## What stays

- The preview callbacks in the generated preview SWF (`src/main/swf/generate.ts`: `inkwellCall`, `inkwellMenuOpen/Close/Reopen`, `inkwellClick`, `inkwellInput`, `inkwellModEvent`, `inkwellMessage`, `inkwellUiScale`, `inkwellGet`) and `previewBus`. The rework calls these.
- The Runtime Trace panel and pin badges, which showed what a call did.

## What now has no way to run in the editor

- Firing an On Widget Call entry (no other control calls `inkwellCall`).
- Sending a mod event or runtime message, and a forwarded input action.
- Open / Close / Reopen and clicking a Button layer by name (a real mouse click in Interact mode still works, and Play mode arrows/Enter as the pad).

## Things that still mention it

- Screenshot drivers that click `play-*` test ids: `screenshotGraph.ts` (6.2), `screenshotMenu.ts`, `screenshotMenuNodes.ts`, `screenshotPopup.ts`. They will fail until they drive the preview another way (for example `previewBus` or the new control).
- `docs/debugging.md` (Play panel and the preview bridge) and comments in `generate.ts`, `previewBus.ts`, `uiScale.tsx` and the preview-SWF tests say "Play panel".
