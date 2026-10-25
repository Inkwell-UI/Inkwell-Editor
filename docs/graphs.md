# Graphs: data layer (Phase 3 of 0.2)

Stub for the data layer only (storage, packs, store, validation). The graph UI (canvas, spawn menu) is Phase 4, codegen Phase 5. Formats are owned by `inkwell-spec` (`graph.ts`, `pack.ts`, `pins.ts`); read them there.

## Files and IPC

- A graph is `swfs/<swf>/graphs/<graphId>.json`. `src/main/project/graphFiles.ts` reads and writes it with `stableStringify` (sorted keys, 2-space indent, trailing newline; array order of nodes and edges is data and kept). Unknown keys at every level survive (the Spec schema is loose). A file that fails the schema or whose `id` differs from its file name is reported as a problem and left on disk, never deleted. Graph ids are checked (`isGraphId`) so an id cannot escape the folder. Writes use the same lock as `overlay.json`.
- `loadProject` returns `swfs[name].graphs` and `saveProject` writes them (never deletes graph files).
- One menu-scope graph per SWF (`createGraph` refuses a second); component graphs are created per component. The id is made from the name (`newGraphId`).
- IPC (`InkwellApi`, channels `graphs:*`, `packs:get`): `listGraphs(swf)`, `loadGraph(swf, id)`, `saveGraph(swf, graph)`, `createGraph(swf, name, scope)`, `deleteGraph(swf, id)`, `getPacks()`. All resolve `{ok:true,...}` or `{ok:false,error}`. Main keeps the last saved copy of every graph (like overlays) and validates it.
- **Overlay `scripts`** holds the graph ids attached to a Figma node (`NodeOverlayPatch.scripts`). The renderer owns overlays, so attaching or detaching a graph is `editNode(swfId, nodeId, {scripts})` in the renderer, next to `createGraph` / `deleteGraph`; main never edits the overlay (a later renderer save would overwrite it).

## Targets and orphans

A component-typed input pin (Text, Button, List, Image, Clip) with no wire takes its Figma layer id from `fields[<pin name>]` (our convention; the Spec leaves `fields` open). If the layer is no longer in the SWF's IR the node becomes an **orphan**: it stays in the file with its fields untouched, `graph-target-missing` is an error pinned to the node (carrying the layer id), and `graphOrphans()` lists it. Same rule as overlay entries: never dropped. Relinking is setting the field again. Graphs of orphaned SWFs are not validated.

## Packs (`src/main/packs/`)

`loadPack(dir)` reads `manifest.json` and `nodes/*.json` (the layout of Inkwell-Core-Pack), validated with `PackManifest` / `NodeDef`. A bad node file is a `problem` and is skipped; the rest loads. `loadPacks(dirs)` never throws. Definitions are indexed as `packId/kind@major` (`defIndex`). The bundled core pack folder is `resources/packs/core` (copy of Inkwell-Core-Pack when it lands), overridden by `INKWELL_CORE_PACK`; until it exists the pack set is empty and every pack node validates as unknown. `compatible.tool` is not evaluated yet (no downloaded packs or `packs.lock` before 0.5). Nodes of packs that are not installed load as ordinary nodes, are listed as `graph-unknown-node` ("Unknown Pack Node (Data Preserved)") and survive save unchanged.

Pin resolution (`resolvePins`): `typeFrom: "<field>"` takes the pin type from that field (a pin type name) or from the graph variable whose id is in it; `extra.dynamicOutputs: "<field>"` appends one data output per `{name, type}` of the array field (On Widget Call params). Entry nodes are `extra.entry`, editor-only nodes `extra.editorOnly`.

## Store (`src/renderer/state/graphStore.ts`)

One zustand store per graph in React Flow shape (nodes, edges; handle ids `<pin>-in` / `<pin>-out`), with `data` holding the whole file node/edge so unknown keys round-trip (`toFlow` / `toGraph`). History is Knotwork's `createHistory`: typing in a field (`setField`, `rename`) coalesces per word, `beginDrag`/`endDrag` make a drag one entry, selection (`setSelection`) is not recorded. Saves are debounced (300 ms) through `setGraphSaver`; `flushGraphSaves()` before closing. Variables live in the graph file: a menu graph holds menu-scope variables, a component graph component-scope ones (`addVariable` sets the scope from the graph); `visibleVariables` gives a component graph the menu variables plus its own.

**One history per SWF (UX 5.5).** Knotwork's history snapshots a single `nodes` array, so overlay and graphs cannot share one zundo store. `state/swfHistory.ts` keeps the order of edits across the SWF's stores (overlay + every graph): Undo reverts the latest edit of that SWF wherever it happened, Redo replays it, a new edit clears Redo, `useUndo` and the status bar read its counts. Limit: if a store trims its oldest entries (100 each) the ordering list can hold a stale key; it is skipped.

## Validation (single source)

`src/shared/graphValidate.ts` `validateGraph(graph, {defs, layers?, siblings?})` returns Knotwork `Issue`s pinned to graph node ids. Codes: `graph-type-mismatch` (Spec `pinCompat`; coercions pass), `graph-required-pin` (non-Exec input without default, wire or target), `graph-dangling-exec` (warning: exec node no event reaches), `graph-exec-cycle`, `graph-target-missing`, `graph-unknown-node`, `graph-duplicate-handler` (same entry kind + name + target, across the SWF's graphs), `graph-bad-wire`. Everything is an error except dangling exec (a warning, an error in Strict Mode).

Main runs it (`session.ts` `refreshGraphLint`) on open, on every graph save/create/delete and after each sync status/layer change, and publishes `SyncUiState.graphLint` (merged into the Lint dock by `useDockRows`, counted in `lintCount`) and `DeploySwf.graphLint` (export gate, Strict Mode). The renderer's live node badges use `createGraphValidation` (Knotwork `createValidation` around the same function), so there is one rule set, run in two places for two readers (dock/gate from saved graphs, canvas from the open one).

## Tests

`graphFiles.test.ts` (golden round-trip of `tests/fixtures/graphs/menu.json`, unknown keys, orphan node kept, unsafe ids, unreadable files, project load/save), `packs.test.ts` (fixture pack `tests/fixtures/packs/test-pack`), `graphValidate.test.ts` (each code, gate), `graphStore.test.ts` (round trip, typing/drag/selection history, debounce, variables, joint SWF history, live validation), `lintRows.test.ts`.
