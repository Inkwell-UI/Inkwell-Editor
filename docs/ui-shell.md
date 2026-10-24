# The editor shell (`src/renderer`, `src/main/session.ts`)

Implements phases 1 and 2 of the UI/UX architecture spec (phase 2: the Settings view with the Setup Doctor checks, `docs/setup-doctor.md`, and Deploy, `docs/deploy.md`) (`inkwell_ui_ux_architecture_specification.md`, workspace root). Where it and `Inkwell Design Spec.md` disagree, the design spec wins. Panel and layout rules: `docs/ui-panels.md`.

## Zones

```
Zone 1  TopBar            shell/TopBar.tsx       project, SWF switcher, target pill, workspace switcher, Setup (opens the Doctor), connection dots, Build All, Deploy (shell/DeployMenu.tsx, MO2), Package (disabled: Planned)
Zone 2  left tabs         navigator | contracts | assets
Zone 3  preview           PreviewPanel           stage toolbar, aspect frame, Inspect overlay, banners, GFx note, last good build
Zone 4  graph             GraphPanel             empty state, AS2 split placeholder
Zone 5  inspector         InspectorPanel
Zone 6A bottom dock tabs  lintBudget | localization | trace | mockData
Zone 6B StatusBar         shell/StatusBar.tsx    spec, last build + history, FFDec, Deploy (progress, result, stage timings), packs, undo scope
```

Zones 2 to 6A are layout panels; Zones 1 and 6B are shell chrome around the layout (they are never moved or resized).

## Workspaces (`workspace/workspaces.ts`)

Wire (default), Verify, Debug: three layouts as data with the same panels and different shares and open dock tab. Switch with the top bar or `Ctrl+1/2/3`. Each remembers its own split sizes and chosen tabs (`state/workspaceStore.ts`, localStorage behind `state/safeStorage.ts`; nothing in the project). A splitter drag is stored under the split's key; double-click resets it.

**Pop out preview.** The stage toolbar's pop-out button asks main to open a second window with the same renderer (`?panel=preview`, only the preview panel with its toolbar and a SWF picker). Main broadcasts sync state, project, preview builds and the Figma selection to every window; selection and the active SWF cross between windows as `UiEvent`s (relayed by main, `origin: 'remote'` so they do not echo). While detached, the main window removes the preview from the layout (`removePanel`), so the graph takes the center. Closing the detached window (or its Dock button) re-docks. The preview's Ruffle time is reported by whichever window shows the stage.

## Stores (`src/renderer/state/`, Zustand; API in each file's header)

| store | holds | persisted |
| --- | --- | --- |
| `workspaceStore` | active workspace, split sizes and chosen tabs per workspace | localStorage |
| `settingsStore` | `mirrorFigma` (Figma -> Inkwell selection mirroring) | localStorage |
| `selectionStore` | selected component, selected graph node, what the Inspector shows, highlighted issue | no |
| `projectStore` | open project (IR + overlays), active SWF | no (main owns it) |
| `overlayStore` | one zundo-backed overlay store per SWF; saves every change to `swfs/<name>/overlay.json` through main | disk, via IPC |
| `syncStore` | latest `SyncUiState` | no |
| `timingStore` | last 50 builds in memory | no |
| `lintStore`, `popoutStore`, `dialogStore` | display filters, detached flag, open dialog | no |
| `toastStore` | up to four toasts (Deploy result), auto-dismiss | no |
| `deployStore` | Deploy scope, busy flag, the pending first-deploy confirmation | no |

`state/bridge.ts` connects IPC to the stores once per window.

## Selection model (UX 2.4; `model/selection.ts`, `state/selectionStore.ts`)

One selected component (a Figma layer, by node id) and one selected graph node.

| Source | Component | Graph node | Inspector shows | Figma |
| --- | --- | --- | --- | --- |
| Navigator row (`selectComponent(id, 'navigator')`) | set | keep | component | would select the layer (planned) |
| Stage click in Inspect mode (`'stage'`) | set | keep | component | would select the layer (planned) |
| Graph node (`selectGraphNode(node, target?)`) | its target, else keep | set | graph node | unchanged |
| Lint row (`selectFromLint({key, nodeId, graphNode?})`) | the issue's | the issue's, else keep | component, issue highlighted | would select the layer (planned) |
| Layer selected in Figma (`applyFigmaSelection(ids, swfs, activeSwfId)`) | set (may switch the active SWF) | keep | component | origin |

Figma -> Inkwell: the plugin's `selection` message reaches the server, main forwards it (`onFigmaSelection`), the bridge resolves it against the project's IR. The "Mirror Figma selection" checkbox in the Figma dot popover turns it off. **Inkwell -> Figma does not exist**: the protocol has no message for it, so `Select in Figma` and `Focus in Figma` are disabled with `needs a protocol message (planned)`. Graph nodes arrive with visual scripting; the store and the Inspector's empty state are ready.

## Data flow

- **Main owns the project** (`main/session.ts`): sync server, build pipeline, latest reports and previews, overlays. `open(dir)` restarts the server on the same port and token (the Figma plugin only reconnects) and pushes `ProjectState` (IR + overlay of every SWF) after swfs change, statuses and builds.
- **Overlay edits** (Inspector role and instance name) go through `overlayStore.editNode` (one history entry), are saved by `saveOverlay` (validated against the spec's `Overlay` schema and identifier rules, unknown keys kept, serialized with the project's other writes by `project/lock.ts`) and trigger a rebuild of that SWF (instance names feed the compiler). The pipeline re-reads `overlay.json` before it saves, so a build never writes back an older overlay. The renderer's overlay store is the source of truth while the project is open; later pushes do not overwrite it.
- **Undo** (UX 5.5): one history per SWF (`Ctrl+Z`, `Ctrl+Shift+Z`/`Ctrl+Y`, or the Inspector buttons; not while typing in a field). The status bar shows `Undo: SWF`. Figma edits never enter it and the visual IR is never touched.
- **Strict Mode** (`project.json` `strictMode`): the lint dock promotes warnings to errors for display (`shared/lint.ts` `promoteStrict`), and the sync server promotes them in the build status (the only build gate that exists: status `error`).
- **One validation source:** the dock, the Navigator badges and the Inspector's issues all read `useDockRows()` (compiler lint rows + unreachable layers + a synthetic `build-failed` row when a build threw).
- **Build failure:** the stage keeps the last good SWF (`usePreviewBuilds`), shows `Build failed - showing last good build` and its `Show error` button opens the Lint dock on the first error. If FFDec/Java is missing, Build All is disabled and the status bar says `FFDec: not found` (opens the Settings view).
- **Status bar timings:** `timingLine` formats the stages and the Ruffle time; the bar is amber when edit-to-preview (pipeline total + Ruffle first frame) is above 1000 ms; a click opens the last 50 builds. The Ruffle time exists only for the SWF the stage shows.

## Navigator, Inspector details

- LAYERS: `model/layerTree.ts` walks the IR (root down, children in order). Badges: lint error/warning counts, `$` only when the text content starts with `$`, script/link/pad from the overlay. Orphans: `model/orphans.ts` (orphaned SWFs, and overlay entries whose node id is not in the IR; unknown keys are listed). Relink and Discard are disabled until overlay editing exists.
- Inspector GFx MAPPING uses `describeTextMapping` from `src/main/swf/text.ts`, the same `sizingFlags` the compiler uses for the TextField. FONT RESOLUTION shows the design spec's order: (1) text style name alias-shaped, (2) font family/style, (3) fallback table (warning `font-fallback`), (4) `font-unmapped`.
- There are no transform or colour inputs anywhere (Figma owns visuals). The `Figma Source` card is read-only text.

## Adding a tab, panel, workspace

- **Panel / tab:** see `docs/ui-panels.md` ("Adding or moving a panel"). A tab's label and disabled state come from the registry's optional `useTabInfo`.
- **Workspace:** add an id to `WorkspaceId`/`WORKSPACE_IDS` and an entry to `WORKSPACES` in `workspace/workspaces.ts` (call `make(id, shares)` or write the layout by hand), add its name to `strings.top.workspaceNames`, and extend the `Ctrl+N` handler in `shell/AppShell.tsx`. `panelRegistry.test.ts` checks it shows every panel once.
- **Dialog:** add an id to `DialogId`, copy to `strings.dialogs`, a branch in `shell/Dialogs.tsx`. `setupDoctor` shows the real `SetupDoctorPanel` (wide dialog); it is reachable from the top bar, the start screen and the status bar link `FFDec: not found`, and opens by itself on the first launch where a check fails. Dialogs and the toast stack also render on the start screen.
- **Popover:** `ui/Popover.tsx` flips to the other side when the panel would leave the window.
- **Deploy:** the dropdown shows each target folder exactly; the first deploy to a folder opens a confirmation dialog (path and file list). See `docs/deploy.md`.

## Deferred, and why

| Item | Arrives with |
| --- | --- |
| Graphs, `[+ Graph]`, AS2 view content, drag-to-graph, Space/Ctrl+F | visual scripting (0.2, Knotwork) |
| Variables, imported AS2, node packs (Assets) | 0.2 / 0.5 |
| Contract validation, Contracts tab content | 0.5 |
| Anchor override, loc keys, bindings, focus controls (disabled in the Inspector) | anchoring codegen, 0.4, 0.2, 0.5 |
| Localization table, Theme, Locale, Pseudo-Loc, Prompts, Focus Graph, Occupied HUD | 0.4, 0.4, 0.4, 0.5, 0.5, 0.6+ |
| Relink / Discard orphans | needs the overlay store's relink operation |
| Select in Figma, Focus in Figma | a protocol message in `inkwell-spec` |
| Runtime trace, game dot, hot reload | Inkwell Runtime (0.3) |
| Vortex staging and zip packaging (Package), custom menu JSON in Deploy, target pill's Config Ownership dialog | packaging; runtime config formats (0.3) |
| Figma plugin screenshot guide in the Settings view, setup guide link | later |
| Play-mode virtual gamepad | later |
| Mock data editor | 0.2 |

## Known limits

- The Ruffle time is measured only for the SWF the stage shows; a build of another SWF has no preview time.
- Strict Mode promotes in the build status and the dock; no export step exists to block yet.
- Window arrangement is remembered per renderer origin; it is not synced between windows.
