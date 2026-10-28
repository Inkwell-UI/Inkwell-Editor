# Functions

Plan and phases: `PLAN-FUNCTIONS.md` (workspace root). This file is what is built so far: **Phase 1** (Spec, Core Pack nodes, codegen, validation, editing logic and a first editor UI). The UI has **not been looked at in the running app yet** (only its store logic is tested): see Editor UI.

## What a function is

A function is a graph file of its own (`swfs/<swf>/graphs/<id>.json`) with `scope: "function"` and a `signature` (Spec `Graph.signature`, no version bump: `Inkwell-Spec/docs/compatibility.md`, Function graphs).

- **Signature:** `inputs` and `outputs` (`{id, name, type, default?}`, types Bool, Number, String, Array, Object) and `exits` (`{id, name}`, at least one). `id` is stable, `name` is what the author sees. Outputs are shared by all exits.
- **Nodes:** **Function Entry** (one per function; its data outputs are the signature inputs), **Function Exit** (field `exit` = an exit id; its data inputs are the signature outputs) and **Call Function** (in any graph of the same SWF). Core pack 0.5.5, `Inkwell-Core-Pack/docs/templates.md`, Functions.
- **Call Function keeps a copy of the signature** in its fields (`function` = the graph id, `inputs`, `outputs`, `exits`), because a pack node definition cannot see another graph. Its pins come from that copy. Wires use pin **names**; the pin ids in the copy let the editor map old names to new ones when it refreshes a call. The validator compares the copy with the function's signature by id, name and type (`graph-function`: "changed since this call was made").
- **No access to the caller's variables.** A function reads and writes only its inputs, outputs and its own variables (locals of one call; `saved` is refused). State goes in as parameters and out as outputs. This keeps a function movable into a pack.

## Generated AS2

Every function graph is its own class (`mods.<mod>.<Swf>Graph_<id>`, the same naming as other graphs). **Each call creates a new instance**:

```
(new mods.M.TGraph_greet(__g.base, __g, {
    Done: function(c_count:Number) {
        try { ... the nodes after the Done pin ... } catch (e) { __g.fail("<entry>", e); }
    },
    Failed: function(c_count:Number) { ... }
})).run("42");
```

- The class has `base`, `owner` (the calling instance) and `exits` (the closures above); in a custom menu `bridge` is copied from the owner. `fail`, `log`, `tr` and the preview/dev trace helpers are the same as in a graph class. There is no `init`, no input or message handlers (events cannot start a function).
- `run(<entry uid>_<input>:Type, ...)` holds the body: the Function Entry's continuation. Function Exit is `__g.exits.<Exit>(<outputs>)`.
- **Why a new instance per call:** timers (`__g.dl`), counters and locals live on the instance. Two calls that overlap (a Delay in the body) each keep their own; on one shared instance the second Delay would cancel the first.
- **Latent nodes:** a Delay, Tween or timer inside the function works; the exit fires when the body reaches Function Exit, now or later. A function that never reaches an exit never continues its caller.
- The frame code and the menu class **never** create function classes (`GraphClass.fn`); only Call Function does. Source maps are per class like for any graph.
- Data outputs of Call Function are the parameters of **every** exit closure; downstream nodes read them as `<call uid>_<output>` like the outputs of any exec node.

## Validation (`graph-function`, `shared/graphValidate.ts`)

Errors: Entry/Exit outside a function graph; a function without a Function Entry or with two; an event node inside a function; a Function Exit whose `exit` is not in the signature; a signature name that is not an AS2 identifier; an input named `function`, `inputs`, `outputs` or `exits` (an unwired input of a call reads the node's field of the same name); an output with the same name as an exit; a call to a missing function; a stale signature copy; a call that leads back into its own function (direct or through other functions). Warning: an exit that has no Function Exit node. Function Entry nodes are not event handlers (`graph-duplicate-handler` ignores them).

`resolvePins(def, node, vars, signature?)` takes the graph's signature (Function Entry and Exit read their pins from it); `extra.dynamicExits` adds one Exec output per entry of a field.

## Editor UI

- **Library:** a left tab in Behaviour (Navigator, Library, Contracts) lists the project's functions with their signature, `+ Function`, rename and delete; clicking one opens it in the Graph panel. Functions are not listed in the Navigator (`graph/GraphsList.tsx`, `functions` flavour; `panels/LibraryPanel.tsx`). Deleting a function that is still called leaves lint errors on its Call Function nodes.
- **Creating:** Library > `+ Function` (a function graph with one exit "Done", Entry wired to Exit; it is not attached to a layer). **Make Function** (Graph panel toolbar) turns the selected nodes into a function and puts one Call Function node in their place (`shared/functions.ts` `extractFunction`, `state/graphDocs.ts` `makeFunction`; one undo step in the open graph, the function file is created and kept). It is refused, with the reason in a toast and nothing created, when the selection has an event, uses a graph variable, is entered at more than one place, or nothing connects to it.
- **Signature editor:** in the Inspector (`graph/SignatureEditor.tsx`): select the Function Entry node to edit the inputs (name, type), the Function Exit node to edit the outputs (name, type) and the exits (name; at least one). A name is applied on Enter or blur and only when valid (identifier, not reserved, unique; outputs and exits share names), so the file never holds a signature the Spec refuses. Each change is one undo step.
- **Calls follow the signature:** the signature is part of the graph store's document. When it changes (edit, undo or redo) the Function Entry / Exit wires follow their pin by id, and every Call Function node in the SWF's other graphs is refreshed (`syncCalls`, not recorded in their histories: they are derived, and undoing the signature brings them back). A call node's own `function` field is a picker; choosing another function copies that signature and drops the wires of pins that no longer exist (`pointCall`). The copied lists are hidden (`extra.managedFields`).
- **Function Exit** has an exit picker (the signature's exits). The Functions node category has its own colour.

## Libraries (export, import, use)

A library is a **pack folder with a `functions/` folder**: `manifest.json`, `functions/<id>.json` (one function graph each, the id is the file name), `CHANGELOG.md`; a pack may also have `nodes/` and `templates/`. A pack's function is called as `<packId>/<functionId>` (the `function` field of a Call Function node).

- **Packs hold nodes and functions.** The Library tab lists every pack the project has (core, installed from GitHub, the project's own). **New pack…** creates an empty `libraries/<id>/`; **drag a function from FUNCTIONS onto a project pack** to move it in (`moveFunctionToPack`: the graph is written to `functions/<id>.json`, every call in the SWF becomes `<packId>/<id>`, the SWF's copy is deleted, so it lives in one place). Refused, nothing changed, when the function calls a function that is still the SWF's own (move that one first) or the pack already has that id. Only project packs accept drops.
- **Export** (a project pack's Export… button): asks for a folder and writes `<folder>/<packId>/` and `<folder>/<packId>-<version>.zip` (upload it as `pack.zip` on a GitHub release `v<version>` to publish: `Inkwell-Core-Pack/docs/packs.md`). The version field is prefilled; a new one is written back into the project's manifest and changelog. `dependencies` is recomputed from the nodes and calls the pack uses. Refused, nothing written, for an empty pack, a bad version or a function with graph errors. `main/packs/libraries.ts` `exportPack`.
- **Import** (Library tab > Import…): a pack folder or zip is read with the normal loader (a broken pack is refused with its problems) and copied to `<project>/libraries/<packId>/`. There is no `packs.lock` entry or hash: it is the project's own copy and travels with the project (git). An id that is already there asks before it is replaced; `core` is refused. Packs installed from GitHub (Assets > Node packs) that have functions show up in the same list.
- **Use:** the Call Function picker lists the SWF's functions and then the libraries' (`Name (packId)`). The compiler compiles every library function a SWF calls, transitively, into that SWF (one class each, `<Swf>Graph_<pack>_<id>`); the library is not needed at runtime. A call to a library that is not installed is a `graph-function` error ("not installed").
- **By reference:** calls hold a copy of the signature like local calls. When a pack changes (an update, an edit, a replaced import) every call whose copy is out of date is refreshed when the pack set loads (wires follow by pin id; `setLibraryFunctions`, not recorded in undo).
- **Edit in place:** a library function opens in the Graph panel (Library tab > the function name) and every change is written back into its pack folder (`saveLibraryFunction`; the store is named `@lib:<packId>`). For a project library (`libraries/`) that is the project's own file. For a pack installed from GitHub it is the downloaded copy in `packs-cache/`: an update or restore replaces it, and the editor says so in the tooltip. **Copy to project** makes an ordinary function of the SWF from a library function.
- **Remove:** project libraries only (deletes `libraries/<id>/`); calls to its functions then show "not installed".

## Verified

- Unit tests: `codegen/functions.test.ts` (generated AS2, frame code, validation). Real FFDec compile of a function and its caller, game and preview flavour: `codegen/functions.integration.test.ts`.
- **Ruffle 0.7.1, 2026-10-28, run by hand:** a caller with two Call Function nodes in a Sequence, both on a function with a Delay named `wait`: both exits fired after one second with their own outputs (`info l1: 1`, `info l2: 2`), no errors. Nothing of this ran in Skyrim's GFx.

## Known limits (v1)

- The UI (including the whole Library tab: export, import, open, copy, remove) is untested by eye; export, import, loading, compiling and validating a library are covered by `main/packs/libraries.test.ts`, the store side by `state/graphStore.library.test.ts`. Nothing of a library ran in Ruffle or the game yet.
- The UI is untested by eye. Make Function does not pull pure nodes that only feed the selection into the function; they stay outside and arrive as inputs.
- `rn`/`wt` flow-trace sequence numbers (`rc`, `tq`) are per instance, so in a Dev build the order of timer traces across a function and its caller is not global. Preview traces carry node ids without a graph id, so a node id reused in two graphs would be ambiguous (matters for libraries, Phase 2).
- A call placed on two exec paths is emitted twice, like any exec node (`docs/codegen.md`).
- Trace ids (`run <node>`, `pin <node>.<pin>`) carry no graph id: a library function whose node ids equal ones in the calling graph is ambiguous in the preview's pin badges.
- A library function that is open for editing while its pack is replaced keeps the version it was opened with.
- Versions are only compared by the author (`dependencies` ranges are written, not yet checked on import); a library built for newer nodes than are installed shows its nodes as unknown pack nodes.
