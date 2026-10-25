# UI panels, layout and the preview (`src/renderer`)

The editor window is a **workspace**: a layout (plain data) places **panels** (self-contained components). Three modes (Layout, Behaviour, Localization) are three layouts over the same panels, each showing only what its job needs; see `docs/ui-shell.md` for the zones, workspaces, stores and the selection model. This file is the panel and layout reference.

## Rules for panels

- A panel takes **no props**. Its data comes from hooks (`src/renderer/hooks/`), stores (`src/renderer/state/`) and the typed IPC API `window.inkwell` (`src/shared/ipc.ts`).
- A panel makes **no layout assumptions**: it fills the box it is given and scrolls its own body (`Panel` chrome does this). It never reads its position or sibling panels. (The preview measures its own height only to switch to a compact toolbar.)
- **No panel imports another panel or the `workspace/` layer** (checked by `workspace/panelRegistry.test.ts`). Panels share state only through stores, hooks or main-process state.
- Every panel wraps itself in `Panel` (title bar, optional collapse; the title bar is hidden when the panel sits in a tab group, the tab names it). All strings are in `strings.ts`; all colors are variables in `theme.css`.
- Icons are lucide-react only. An icon-only control gets a tooltip (`title`) AND an accessible name (`aria-label`): use `ui/Btn`. A control that does not apply yet is shown disabled with a one-line reason (`Btn reason=...`, `aria-disabled`, still focusable so the reason is reachable), never hidden.

## Panels

| id | Component | Zone | Data | Shows |
| --- | --- | --- | --- | --- |
| `navigator` | `NavigatorPanel` | 2 (tab) | project IR + overlay, `useDockRows()`, sync state | graphs (empty), LAYERS tree with badges and filter, orphaned overlays, unreachable Figma layers |
| `contracts` | `ContractsPanel` | 2 (tab) | active SWF target | `Only for menu replacements` (tab disabled), else `Contract validation arrives in 0.5` |
| `assets` | `AssetsPanel` | 2 (tab) | none | Variables / Imported AS2 / Node packs empty states |
| `preview` | `PreviewPanel` | 3 | `usePreviewBuilds()`, project, sync state, selection store | stage toolbar, aspect frame, safe zones, Inspect overlay, banners, GFx note, last good build |
| `graph` | `GraphPanel` | 4 | active SWF, selection | graph header and empty state, AS2 split placeholder (Knotwork arrives in 0.2) |
| `inspector` | `InspectorPanel` | 5 | selection, project, overlay store, sync fonts, `useDockRows()` | issues, GFx mapping, font resolution, behavior overlay (editable role and instance name), Figma Source |
| `lintBudget` | `LintBudgetPanel` | 6A (tab) | `useDockRows()`, lint store, project | lint list with severity filter, current-SWF-only, Strict Mode, HUD budget meter |
| `localization` | `LocalizationPanel` | 6A (tab) | none | table scaffold, `arrives in 0.4` |
| `trace` | `TracePanel` | 6A (tab) | none | `Start Skyrim with Dev Mode enabled` (arrives with the runtime) |
| `mockData` | `MockDataPanel` | 6A (tab) | none | empty state |

The top bar (Zone 1) and the status bar (Zone 6B) are shell chrome in `src/renderer/shell/`, not layout panels. The old Connection, Build status, Timing, Fonts and Lint panels are gone: the connection details (port, token, copy) are in the Figma dot popover, timings in the status bar, the font report in the Inspector and the lint list in the dock.

### Hooks

- `useSyncState(): SyncUiState | undefined` (live; fed by the bridge into `syncStore`).
- `usePreviewBuilds(): StageEntry[]` (one per SWF, sorted by name). Each entry has `latest`, `shown` (the latest build with a SWF, else the last good one: the stage is never blank) and `stale`. **Restore hook:** on mount it asks main for the latest builds (`getPreviewBuilds`), so a reload restores the preview. Mock data later goes here.
- `useProject()`, `useActiveSwf()`, `useActiveOverlay()` (the active SWF's undoable overlay), `useDockRows()` (the one merged lint list, Strict Mode applied), `useUndo()`.
- `useElementSize(): [ref, {width, height}]` (ResizeObserver) for fluid sizing.

### IPC (`src/shared/ipc.ts`, preload `window.inkwell`)

`getSync/onSync`, `getPreviewBuilds/onPreviewBuild`, `getPreviewFonts`, `reportPreviewRendered`, `getProject/onProject`, `newProject/openProject/openExample` (native dialogs in main), `getRecentProjects`, `saveOverlay`, `setStrictMode`, `buildAll`, `setPreviewDetached/getPreviewDetached/onPreviewDetached`, `sendUiEvent/onUiEvent` (selection and active SWF relayed to the other window), `onFigmaSelection`. The preload is typed `InkwellApi`; channel names are in `IPC`. The preview SWF travels as an `ArrayBuffer` in `PreviewBuild.bytes` (absent when the preview build failed; then `error` says why). Main broadcasts to every window, so the popped-out preview gets the same builds.

## Adding or moving a panel

1. Write `panels/FooPanel.tsx`: `export function FooPanel() { ...; return <Panel title={...}>...</Panel> }`. A new data source gets a hook or store (and an IPC method in `shared/ipc.ts` + preload + main if it comes from main).
2. Register it in `workspace/panelRegistry.ts`: `foo: { title, component, defaultSize, minSize }`; add `useTabInfo` (label with counts, or `disabledReason`) if it lives in a tab group.
3. Place its id in the mode(s) that need it in `workspace/workspaces.ts`. The registry test requires every registered panel to appear in at least one mode and none twice in one mode.
4. **Moving** a panel is editing the layout data only.

## Layouts

A layout is a JSON-serializable tree (`workspace/layout.ts`):

```ts
type LayoutNode =
  | { kind: 'panel'; panel: string; size?: number }                                  // registry id
  | { kind: 'split'; direction: 'row' | 'column'; children: LayoutNode[]; size?: number }
  | { kind: 'tabs'; tabs: PanelNode[]; active?: string; size?: number }              // several panels, one slot
```

`size` is the share (flex-grow, basis 0) along the parent split. `validateLayout(layout, ids)` returns a list of problems (unknown ids, duplicates, empty splits/tabs, bad direction or size, tabs that are not panels, an `active` that is not a tab, wrong shapes); `Workspace` shows them instead of rendering a bad layout. Helpers: `layoutPanelIds`, `nodeKey` (identity of a split/tab group: the first panel ids of its children joined with `|`), `removePanel` (collapses single-child splits; used while the preview is popped out), `applyOverrides` (the user's sizes and tabs on top of the data), `tabsKeyOf`.

`Workspace` draws a splitter between the children of every split (pointer drag, arrow keys, double-click resets that split) and reports sizes through `onResize(key, sizes)`. Remembering them is `state/workspaceStore.ts` (per workspace, localStorage behind a guarded wrapper, nothing in the project). To adopt a docking library, replace `Workspace.tsx` (it is the only component that reads the layout) and convert the data; panels do not change.

## Preview pieces (`src/renderer/preview/`)

All pure presentational except the backend and the controller; props are documented in each file.

- `PreviewBackend` (`backend.ts`): `element`, `load(build)`, `on('loaded' | 'error' | 'firstFrame', cb)`, `dispose()`. "Show this build result." `RuffleBackend` is the only 1.0 implementation.
- `controller.ts`: DOM-free logic (load, measure build-received -> first frame, ignore stale loads, error from a failed preview build); tested with a fake backend.
- `SwfViewport` (stage fitted into its container, showAll letterbox), `AspectFrame` (16:9, 16:10, 21:9, 32:9, 4K screen box; 4K is 3840x2160, the same shape as 16:9), `SafeZoneOverlay` (title-safe 90 %, action-safe 93 %, conventional broadcast values, not measured from Skyrim), `StageToolbar` (Inspect/Play, aspect, reload, pop out, zoom, safe zones; Occupied HUD, Focus Graph, Prompts, Theme, Locale, Pseudo-Loc disabled with reasons; compact mode behind "More" when the strip is short), `InspectOverlay` (hover and selection outlines and click picking from the IR geometry), `ShimBadge` (GFx approximation note with the active shims).
- `geometry.ts`: `fitStage`, `safeRects`, `screenBox`, `stepZoom`, `toStagePoint` (unit tested). `model/hitTest.ts`: stage-space bounds from the IR (parent-relative transforms, rotated nodes use their rotated bounding box) and the topmost-hit test.

### Ruffle

`@ruffle-rs/ruffle` 0.7.1 (exact), self-hosted: `electron.vite.config.ts` serves the package folder as the renderer's `publicDir`, so `ruffle.js`, `core.*.js` and the `.wasm` files sit next to `index.html` in dev and in `out/`. `RuffleBackend` loads `ruffle.js` by script tag and sets `publicPath` to the page's folder; the page CSP allows `'wasm-unsafe-eval'` for it. No network at runtime.

Ruffle approximates Flash, not Scaleform GFx. It cannot load `gfxfontlib.swf`, so the **preview SWF** (`build/<name>.preview.swf`, `compileSwf(..., { preview: true })`) draws text with embedded glyph outlines of a font named per alias (device fonts do not draw rotated; installed Skyrim fonts or bundled OFL lookalikes registered as Ruffle `fontSources`; see `docs/preview-fonts.md`) instead of the imported font, keeping size, colour, alignment and layout. It ignores GFx TextField extensions and filters; the badge lists what the current build leaves out. The preview SWF also starts its frame code with stubs for `skse`, `gfxExtensions` and the Inkwell bridge, and a HUD widget IR previews as its design frame at the design size (no widget wrapper). A failing preview build never fails the game build; the error shows in the preview panel.

## Debug

`INKWELL_PREVIEW_FONTS=auto|installed|bundled` forces the preview font source. `INKWELL_SCREENSHOT=<png>`: builds the project's SWFs at start (needs `INKWELL_PROJECT`), saves the window to the PNG after the first preview rendered, then exits. `INKWELL_SHOTS_DIR=<folder>` + `INKWELL_SHOTS_PROJECT=<scratch project copy>`: `src/main/screenshotDriver.ts` drives the real UI (keyboard, DOM clicks, synthetic pointer events on the Inspect overlay) and saves a-start, b-wire, c-verify, d-debug, e-selected, i-stage-hover, j-stage-select, k-overlay-edit, f-compile-fail (a failure injected into the sync server's `onChange`), g-popout and h-detached-main. It builds into and edits the project it is given: use a copy, a separate `--user-data-dir` and `env -u ELECTRON_RUN_AS_NODE`.
