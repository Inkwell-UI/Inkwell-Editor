# UI panels, layout and the preview (`src/renderer`)

The editor window is a **workspace**: a layout (plain data) places **panels** (self-contained components). The layout is expected to change; panels and the preview pieces are built so it can change without touching them.

## Rules for panels

- A panel takes **no props**. Its data comes from hooks (`src/renderer/hooks/`) and the typed IPC API `window.inkwell` (`src/shared/ipc.ts`).
- A panel makes **no layout assumptions**: it fills the box it is given and scrolls its own body (`Panel` chrome does this). It never reads its position or sibling panels.
- **No panel imports another panel** (checked by `workspace/panelRegistry.test.ts`). Panels share state only through hooks or main-process state.
- Every panel wraps itself in `Panel` (title bar, optional collapse). All strings are in `strings.ts`.

## Panels

| id | Component | Data | Shows |
| --- | --- | --- | --- |
| `connection` | `ConnectionPanel` | `useSyncState()` | Figma plugin connection, port, session token (+ copy) |
| `buildStatus` | `BuildStatusPanel` | `useSyncState()` | build state, SWF count, lint count |
| `fonts` | `FontsPanel` | `useSyncState().fonts` | how each text layer's font resolved |
| `lint` | `LintPanel` | `useSyncState().lint` | lint issues, errors first |
| `timing` | `TimingPanel` | `useSyncState().timing`, `.previewMs` | every stage (`sync`, `codegen`, `swf`, `ffdec`, `preview-build`), total, preview time, edit-to-preview (pipeline total + preview; the Figma debounce is not included) |
| `preview` | `PreviewPanel` | `usePreviewBuilds()`, reports via `window.inkwell.reportPreviewRendered` | toolbar, aspect frame with the stage fitted inside, safe zones, Ruffle badge |

### Hooks

- `useSyncState(): SyncUiState | undefined` (live; `getSync` + `onSync`).
- `usePreviewBuilds(): PreviewBuild[]` (latest build per SWF, sorted by name). **Restore hook:** on mount it asks main for the latest builds (`getPreviewBuilds`), so a reload restores the preview. Mock data later goes here.
- `useElementSize(): [ref, {width, height}]` (ResizeObserver) for fluid sizing.

### IPC (`src/shared/ipc.ts`, preload `window.inkwell`)

`getSync`, `onSync`, `getPreviewBuilds`, `onPreviewBuild`, `getPreviewFonts`, `reportPreviewRendered`. The preload is typed `InkwellApi`; channel names are in `IPC`. The preview SWF travels as an `ArrayBuffer` in `PreviewBuild.bytes` (absent when the preview build failed; then `error` says why).

## Adding or moving a panel

1. Write `panels/FooPanel.tsx`: `export function FooPanel() { const s = useSyncState(); return <Panel title={...}>...</Panel> }`. A new data source gets a hook in `hooks/` (and an IPC method in `shared/ipc.ts` + preload + main if it comes from main).
2. Register it in `workspace/panelRegistry.ts`: `foo: { title, component, defaultSize, minSize }`. `defaultSize` is the flex basis (px) along a split's axis, `minSize` is the slot minimum.
3. Place its id in a layout (`defaultLayout` in `workspace/layout.ts`). The registry test requires the default layout to show every registered panel once.
4. **Moving** a panel is editing the layout data only.

## Layouts

A layout is a JSON-serializable tree (`workspace/layout.ts`):

```ts
type LayoutNode =
  | { kind: 'panel'; panel: string; size?: number }                    // registry id
  | { kind: 'split'; direction: 'row' | 'column'; children: LayoutNode[]; size?: number }
```

`size` is the share (flex-grow, default 1) along the parent split. `validateLayout(layout, ids)` returns a list of problems (unknown ids, duplicates, empty splits, bad direction or size, wrong shapes); `Workspace` shows them instead of rendering a bad layout. Nothing is persisted yet. To adopt a docking library, replace `Workspace.tsx` (it is the only component that reads the layout) and convert the data; panels do not change.

## Preview pieces (`src/renderer/preview/`)

All pure presentational except the backend and the controller; props are documented in each file.

- `PreviewBackend` (`backend.ts`): `element`, `load(build)`, `on('loaded' | 'error' | 'firstFrame', cb)`, `dispose()`. "Show this build result." `RuffleBackend` is the only 1.0 implementation.
- `controller.ts`: DOM-free logic (load, measure build-received -> first frame, ignore stale loads, error from a failed preview build); tested with a fake backend.
- `SwfViewport` (stage fitted into its container, showAll letterbox), `AspectFrame` (16:9, 16:10, 21:9, 32:9 screen box), `SafeZoneOverlay` (title-safe 90 %, action-safe 93 %, conventional broadcast values, not measured from Skyrim), `PreviewToolbar`, `ShimBadge`.
- `geometry.ts`: `fitStage`, `safeRects`, `screenBox` (unit tested).

### Ruffle

`@ruffle-rs/ruffle` 0.7.1 (exact), self-hosted: `electron.vite.config.ts` serves the package folder as the renderer's `publicDir`, so `ruffle.js`, `core.*.js` and the `.wasm` files sit next to `index.html` in dev and in `out/`. `RuffleBackend` loads `ruffle.js` by script tag and sets `publicPath` to the page's folder; the page CSP allows `'wasm-unsafe-eval'` for it. No network at runtime.

Ruffle approximates Flash, not Scaleform GFx. It cannot load `gfxfontlib.swf`, so the **preview SWF** (`build/<name>.preview.swf`, `compileSwf(..., { preview: true })`) draws text with a device font named per alias (installed Skyrim fonts or bundled OFL lookalikes registered as Ruffle `fontSources`; see `docs/preview-fonts.md`) instead of the imported font, keeping size, colour, alignment and layout. It ignores GFx TextField extensions and filters; the badge lists what the current build leaves out. The preview SWF also starts its frame code with stubs for `skse`, `gfxExtensions` and the Inkwell bridge, and a HUD widget IR previews as its design frame at the design size (no widget wrapper). A failing preview build never fails the game build; the error shows in the preview panel.

## Debug

`INKWELL_PREVIEW_FONTS=auto|installed|bundled` forces the preview font source. `INKWELL_SCREENSHOT=<png>`: builds the project's SWFs at start, saves the window to the PNG after the first preview rendered, then exits.
