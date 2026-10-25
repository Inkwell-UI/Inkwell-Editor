# Graph codegen (Phase 5 of 0.2)

Graphs (`swfs/<swf>/graphs/<id>.json`) compile to AS2 classes inside the SWF. Template format: `Inkwell-Core-Pack/docs/templates.md`; graph and pack formats: `inkwell-spec`; storage and validation: `docs/graphs.md`.

## Files

- `src/main/codegen/codegen.ts`: `generateGraphClasses({modId, swfCls, graphs, packs, layerPath})` is pure and returns `{classes, issues}`. A class has `source`, `path`, `map` (source map) and `calls` (the On Widget Call signatures).
- `src/main/codegen/packs.ts`: `loadCodegenPacks(dirs)` loads node definitions plus template text (`resources/packs/core` by default; `INKWELL_CORE_PACK` overrides, see `corePackDir`).
- `src/main/swf/generate.ts` takes `GenerateOptions.graphs = {graphs, packs}`; `Generated` returns `graphClasses` and `graphCalls`. `compileSwf` writes `<buildDir>/<swf id>/graph-<graphId>.map.json` next to the SWF build.
- Test helpers: `codegen.testutil.ts` (one fixture graph per node kind).

## The bundled core pack

`resources/packs/core` (manifest, `nodes/`, `templates/`) is a copy of `../Inkwell-Core-Pack`; `yarn sync:core-pack` refreshes it. Edit templates in the Core-Pack repo, never here. `compatible.tool` is still not evaluated (docs/graphs.md); the loader finds the pack by default, so `^0.2.0` cannot fail.

## What one class looks like

`mods.<modId>.<Swf>Graph_<graphId>` (one per graph; ids become identifiers, a clash gets `_2`). Members: `base` (the clip the graph lives on), `fail(nodeId, e)`, `addInputHandler(action, fn)`, `handleInput(action)` and `init()`. The constructor takes the base clip; the frame code of the SWF does `<base>.inkwellGraph0 = new mods.M.Cls(<base>); <base>.inkwellGraph0.init();` after the widget contract and layout classes. The base is the `widget` clip for a HUD widget and the main timeline otherwise (the Ruffle preview too: same code, `preview: true`).

`init()` starts with `var __g = this;` (closures keep it, so templates can always say `__g`), the graph variables (`__g.v_<name> = default`), then one block per entry node in graph order. Per-node state is on `__g` (`s_`, `t_`, `h_` + node uid).

- **Not `dynamic`.** FFDec's AS2 compiler does not parse the keyword (the build fails to parse the class). Sealing is a compile-time check only and FFDec does not run it, so adding members works the same.
- `fail` accepts a string or a plain object `{node, message}`, traces `[Inkwell] error <node id>: <message>` and also calls `skse.Log` when it exists. There is no `Error` class anywhere.
- `addInputHandler` only stores the handler. Nothing calls `handleInput` in 0.2 (no input source before the runtime, 0.3).
- `onLoad`, `onOpen`, `onClose` events register `__g.onLoad` etc. Only **On Load is called**, at the end of `init()` (`if (__g.onLoad != undefined) __g.onLoad();`, emitted only when the graph has an On Load node): the graph is created after every clip is placed, so a HUD widget uses it to start hidden (`samples/hud-graph-popup`). On Open and On Close wait for the runtime (0.3).

## How a node becomes code

Placeholders are the ones in `templates.md`. Rules the renderer adds:

- **Inputs.** A wired input is the source's expression: a pure node's expression, or `<uid>_<pin>` for an output of an exec node or entry (a local or handler parameter). Unwired: component pins (`Text`, `Button`, `List`, `Image`, `Clip`) take the Figma layer id from `fields[<pin name>]` and become `__g.base.<clip path>`; the path is built by the same naming logic the compiler uses for placing clips (overlay instance name, else sanitised layer name, `_2` for duplicates), recorded while the clips are placed. Other pins use `fields[<pin name>]` if present, else the pack's default, else the zero of the effective type (`typeFrom` retypes the pin and drops the pack default of the old type). `pinCompat` `coerce` wraps in `Number(...)` / `String(...)`.
- **Parentheses.** A non-atomic expression is wrapped in `( )` (`isAtomic`: name path, literal, `[]`, `{}`, a full parenthesised group or a call).
- **Raw and var.** `{{raw.x}}` only accepts a value from the field's `enum` or matching its `pattern` (code injection through a field is refused); a refused or invalid node becomes a `// [id] skipped: ...` comment plus an issue, and the rest of the graph still compiles. `{{var.f}}` is `__g.v_<ident(variable name)>`.
- **`{{node.id}}`** is escaped for AS2 strings; `{{node.uid}}` is the identifier-safe id (unique per graph).
- **Continuations.** `{{next.x}}` / `{{guarded.x}}` must be alone on their line; the sub-statements are re-indented. `guarded` wraps them in `try { } catch (e) { __g.fail("<entry id>", e); }` where the id is the entry node of the handler being built. Several wires from one exec pin run in wire order.
- **Entries.** The entry's block is the registration statement from its template, placed in `init()`. `{{params}}` is `<uid>_<name>:String|Number|Boolean`. For an On Widget Call, codegen adds `__g.base.<name> = function(a) {...}`: Papyrus passes all arguments as one `String[]` (UI.Invoke* cannot mix types), and this method converts them to the typed parameters with the pin defaults (`""`, `0`, `false`). A call without parameters arrives through `UI.InvokeBool`.
- **Cycles.** Exec cycles are cut at the second visit with an issue (validation already blocks them); a data cycle between pure nodes skips the consumer.

### Pure nodes: inline, temp, volatile

- Used by one consumer: inlined.
- Used by several (edges counted in the whole graph): `var t_<uid> = <expr>;` before the first consumer, reused by later consumers.
- A template that repeats `{{in.x}}` gets a non-trivial argument hoisted into `var t_<uid>_<pin>` (trivial = name path or literal).
- **Volatile** (`extra.volatile`: Get Variable, Get Text) and everything that depends on one are never cached, so a write between two reads is seen.
- **Scope.** A temp lives in the block where it was first needed. Branch arms, Sequence outputs, `guarded` closures and For Each bodies are child blocks: they see the temps of the enclosing blocks but their own temps are not reused by siblings or by code after them (Flash 8 has no block scope, so reuse would read an unset variable on the other path). A node that depends on `{{out.item}}` or `{{out.index}}` of a loop is therefore evaluated inside the body function, once per iteration. Temp names are unique per class (`t_p`, `t_p_2`).
- shortcut: a loop-independent pure node first used inside a loop body is evaluated once per iteration (correct, but not hoisted before the loop); an exec node reachable by two exec wires is emitted twice with the same local names.

## Source map (5.3)

`GraphClass.map = {version: 1, graph, file, lines: {"<1-based line>": "<graph node id>"}}`; scaffolding lines have no entry. Temps map to the node that needed them, the `try/catch` lines to the node whose continuation they wrap. Written as `graph-<id>.map.json` in the SWF's build folder and returned by `compileSwf` (`graphClasses`) for the split view and for traces (Phase 6).

## Data bindings and the preview build (Phase 6)

`CodegenInput.bindings` (overlay `dataBinding` strings by layer id) become per-variable bind functions called on init and after every Set Variable; `CodegenInput.preview` (the Ruffle preview SWF only) adds pin value traces (`__g.pv`) and mock data hooks. Details, formats and limits: `docs/debugging.md`. The game build is unchanged by `preview` (test).

## Pipeline

- **`generate` / `compileSwf`** (`graphs` option): classes are added like the layout class (exported as `__Packages.mods.<mod>.<cls>`). Codegen issues become lint errors `graph-codegen` on the root frame (message names the graph and node). Without graphs, or with an empty list, the output is byte-identical to before (test).
- **HUD widgets.** If a graph has an On Widget Call, the widget class has no hardcoded popup API (`setTexts`, `show`, `hide`, fade; the graph does that with Set Text, Set Alpha, Delay...) and the Papyrus script gets one typed function per entry instead (`generateScripts({calls})`): `Function Show(String asTitle, Float afHold, Bool abSticky)` (prefix `as`/`af`/`ab` + capitalised name), `UI.InvokeStringA(..., WidgetRoot + ".<Name>", a)`, a call before the widget is ready is remembered (the last one) and replayed once in `OnWidgetReset`. `Test()` and the debug hotkey stay and call the first entry (graph file order: ids sort alphabetically) with sample arguments (strings: `"Inkwell test"`, `"Text 2, ..."`; numbers 4.0; bools True). Names that are not Papyrus identifiers or collide with `Test`, `OnKeyDown`, `Ready`, `X`, `Y`, `Alpha`... throw (deploy shows the message). Without an On Widget Call the old API is generated unchanged.
- **Sync build** (`buildPipeline`, `packDirs`): the game SWF and the Ruffle preview SWF are compiled with the SWF's saved graphs (read from disk each build). Phase 6 only has to run the preview SWF.
- **Deploy** (`DeploySwf.graphs`, `DeployInput.packs`): hudWidget compiles with the graphs; `validateGraph` errors reach the export gate as before.

## Tests

`codegen.test.ts` (golden AS2 per node kind in `__snapshots__`, caching, errors, source map), `templates.integration.test.ts` (every core template compiled by the real FFDec; skipped with a warning without Java/FFDec/wrapper jar), `widget/graphWidget*.test.ts` (samples/hud-graph slice, Papyrus, preview path), `sync/buildPipeline.test.ts`, `deploy/run.test.ts`.

A passing FFDec compile means the AS2 **parses** and the class is in the SWF. FFDec's compiler does no type checking, and nothing here was run in Ruffle or the game.

## FFDec wrapper change

`com.inkwell.Wrapper` used to ignore scripts FFDec could not parse (it logs SEVERE and leaves the class empty, the SWF still builds). It now fails the job with `AS2 script error: ...`. Rebuild the jar (`yarn build:wrapper`, git-ignored) after pulling.
