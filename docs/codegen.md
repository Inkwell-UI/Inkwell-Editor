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

**Menu replacement glue (W5, `codegen/replacementGlue.ts`).** A `menuReplacement` with a known contract and valid `target.layers` gets `mods.<modId>.<Swf>Contract`, built from the merged contract (`lint/contract.ts` `contractFor`) and modelled on spike S-B (`scripts/spike-05b.ts`): every root function of the contract (the one with members, `GetInventoryItemList`, returns the list object with `entryList`, `selectedIndex` and the spike's other list members; the others fire a callback of their own name), `ExternalInterface.addCallback` for `call` (engine callbacks, dispatched by name to the handlers contract nodes register) and `respond` (answers to `send(name, args, respondTo)`, matched by a request counter), and the `_global` statics of the picked layers that carry a `value` (SkyUI 5.2: four classes, `SKYUI_RELEASE_IDX = 2018`, `SKYUI_VERSION_STRING = "5.2 SE"`). Entries flagged `unused` are left out. The frame code installs it at `_root.inkwellContract` before the graphs are created; what it defines (`Generated.contractProvided`) joins the compiled layer paths in the contract lint, so only the Figma clip (`Menu_mc`) is left to the designer. The preview flavour registers no ExternalInterface callback and traces engine calls. Contract nodes (node field `contract`) are graph errors (`contract-node-target`) anywhere but a replacement of their contract; runtime nodes warn (`runtime-required`) in a replacement, which has no Inkwell bridge. Golden AS2: `replacementGlue.test.ts`; FFDec: `replacementGlue.integration.test.ts`.

`init()` starts with `var __g = this;` (closures keep it, so templates can always say `__g`), the graph variables (`__g.v_<name> = default`), then one block per entry node in graph order. Per-node state is on `__g` (`s_`, `t_`, `h_` + node uid).

- **Not `dynamic`.** FFDec's AS2 compiler does not parse the keyword (the build fails to parse the class). Sealing is a compile-time check only and FFDec does not run it, so adding members works the same.
- `fail` accepts a string or a plain object `{node, message}`, traces `[Inkwell] error <node id>: <message>` and also calls `skse.Log` when it exists. There is no `Error` class anywhere.
- `addInputHandler` only stores the handler. Nothing calls `handleInput` in a HUD widget (no input source); in a custom menu the menu class does (below).
- `onLoad`, `onOpen`, `onClose` events register `__g.onLoad` etc. **On Load is called** at the end of `init()` (`if (__g.onLoad != undefined) __g.onLoad();`, emitted only when the graph has an On Load node): the graph is created after every clip is placed, so a HUD widget uses it to start hidden (`samples/hud-graph-popup`). **On Open and On Close are called by the menu class** of a custom menu (`docs/menus.md`); a HUD widget never calls them (lint `runtime-required`).

## Custom menus: the menu flavour and the glue class

For `ir.target.kind === 'customMenu'` `swf/generate.ts` passes `menu: true` to codegen and adds the class `mods.<modId>.<Swf>Menu` (`codegen/menuGlue.ts`), whose `start()` creates and `init()`s the graph classes after the runtime bridge is ready, instead of the frame code. The menu flavour of a graph class adds `var bridge`, `log`, `addMessageHandler`/`handleMessage`, `addModEventHandler`/`handleModEvent`, routes `fail` and the Log node through `__g.log` (`toBridgeLog` rewrites the filled Log line; the Core-Pack template is unchanged) and leaves everything else as is. Component events (On Click, On Focus, On Blur, On Value Changed, On Item Selected) still register themselves in `init()`; the glue does not wire them a second time. Everything about it: `docs/menus.md`.

## How a node becomes code

Placeholders are the ones in `templates.md`. Rules the renderer adds:

- **Inputs.** A wired input is the source's expression: a pure node's expression, or `<uid>_<pin>` for an output of an exec node or entry (a local or handler parameter). Unwired: component pins (`Text`, `Button`, `List`, `Image`, `Clip`) take the Figma layer id from `fields[<pin name>]` and become `__g.base.<clip path>`; the path is built by the same naming logic the compiler uses for placing clips (overlay instance name, else sanitised layer name, `_2` for duplicates), recorded while the clips are placed. Other pins use `fields[<pin name>]` if present, else the pack's default, else the zero of the effective type (`typeFrom` retypes the pin and drops the pack default of the old type). `pinCompat` `coerce` wraps in `Number(...)` / `String(...)`.
- **Parentheses.** A non-atomic expression is wrapped in `( )` (`isAtomic`: name path, literal, `[]`, `{}`, a full parenthesised group or a call).
- **Raw and var.** `{{raw.x}}` only accepts a value from the field's `enum` or matching its `pattern` (code injection through a field is refused); a refused or invalid node becomes a `// [id] skipped: ...` comment plus an issue, and the rest of the graph still compiles. `{{var.f}}` is `__g.v_<ident(variable name)>`.
- **`{{node.id}}`** is escaped for AS2 strings; `{{node.uid}}` is the identifier-safe id (unique per graph).
- **Continuations.** `{{next.x}}` / `{{guarded.x}}` must be alone on their line; the sub-statements are re-indented. `guarded` wraps them in `try { } catch (e) { __g.fail("<entry id>", e); }` where the id is the entry node of the handler being built. Several wires from one exec pin run in wire order.
- **Entries.** The entry's block is the registration statement from its template, placed in `init()`. `{{params}}` is `<uid>_<name>:String|Number|Boolean`. For an On Widget Call, codegen adds `__g.base.<name> = function(a) {...}`: Papyrus passes all arguments as one `String[]` (UI.Invoke* cannot mix types), and this method converts them to the typed parameters with the pin defaults (`""`, `0`, `false`). A call without parameters arrives through `UI.InvokeBool`.
- **Cycles.** Exec cycles are cut at the second visit with an issue (validation already blocks them); a data cycle between pure nodes skips the consumer.

### Keyed Set Text (custom menus, 0.5)

In a menu class the `text` input of Set Text is wrapped in `__g.tr(...)` when it is a `$KEY` literal or a wire; `tr(s)` returns `bridge.translate(s)` for a string starting with `$`, else `s`. The member is emitted only when a Set Text uses it, so graphs without keys compile as before. Details: `docs/localization.md`, Keyed Set Text in graphs.

### Time (0.5, SPEC-CHANGES V13.4)

No generated code counts frames: a custom menu runs `onEnterFrame` about 700 times a second while the game is paused. Get Time is `getTimer() / 1000` (pure, volatile) and On Update is a `setInterval` every `seconds` (default 0.1) whose `delta` output is measured with `getTimer()`; Stop Timer stops it by its `name`. Templates: Core-Pack `docs/templates.md`.

### Pure nodes: inline, temp, volatile

- Used by one consumer: inlined.
- Used by several (edges counted in the whole graph): `var t_<uid> = <expr>;` before the first consumer, reused by later consumers.
- A template that repeats `{{in.x}}` gets a non-trivial argument hoisted into `var t_<uid>_<pin>` (trivial = name path or literal).
- **Volatile** (`extra.volatile`: Get Variable, Get Text, Get Alpha, Get Visible, Random, Get Time) and everything that depends on one are never cached, so a write between two reads is seen (and two consumers of one Random get two numbers). Counter, Toggle and Get Position are exec nodes: their outputs are locals of the run (`<uid>_value`, `<uid>_x`), so a pure node reading them is cached normally, after the statement that made them.
- **Scope.** A temp lives in the block where it was first needed. Branch arms, Sequence outputs, `guarded` closures and For Each bodies are child blocks: they see the temps of the enclosing blocks but their own temps are not reused by siblings or by code after them (Flash 8 has no block scope, so reuse would read an unset variable on the other path). A node that depends on `{{out.item}}` or `{{out.index}}` of a loop is therefore evaluated inside the body function, once per iteration. Temp names are unique per class (`t_p`, `t_p_2`).
- shortcut: a loop-independent pure node first used inside a loop body is evaluated once per iteration (correct, but not hoisted before the loop); an exec node reachable by two exec wires is emitted twice with the same local names.

## Node notes (the 88-node core pack)

Codegen has no per-node code except the Set Variable / Toggle rule below; everything else is in the templates (`Inkwell-Core-Pack/docs/templates.md`). What the generated AS2 relies on:

- **Registries on the graph instance** (`__g`, created lazily by the templates, not declared in the class): `dl` Delay timer ids by key (node's `name` field, else its node id), `tm` On Timer ids by the same rule (On Timer clears its old interval when armed and ignores ticks before half the period by `getTimer()`, because the game's `setInterval` can burst in a paused menu), `tw` the running Tween records `{t, p, id}`, `ctr` Counter values by name. A second entry into a Delay clears its pending timer first (retriggerable); Cancel Delay and Stop Timer clear by key; Stop Tweens clears by target. A Delay in a For Each body therefore keeps only the last iteration's continuation.
- **Untyped Array/Object items:** `valueType` (a field) retypes the item pins through `typeFrom` (`resolvePins`), an unwired item pin gets the zero of that type, and the template coerces its output with the same type name, so `pinCompat` against the neighbours is checked on the chosen type.
- **Pure nodes with statements** (Array Push / Sort By Field, Make Object, Set Field, Join, Random) are one function expression called as `({ f: function(a, b) {...} }).f(<inputs>)` (a direct call of a function expression compiles with FFDec but returns `undefined` in Ruffle); `isAtomic` sees a leading `(` whose group does not close at the end and wraps them in parentheses. Array Push, Sort By Field and Set Field copy, they never change their input.
- **Set Variable and Toggle** both refresh the variable's data bindings (`__g.b_<name>()` after the statement).
- Get Position, Counter and Toggle are not pure (they declare locals with `var {{out.x}}`); Get Alpha, Get Visible and Random are pure and volatile.
- Fade is untouched; it is not on the Tween registry, so Stop Tweens does not stop it.

## Source map (5.3)

`GraphClass.map = {version: 1, graph, file, lines: {"<1-based line>": "<graph node id>"}}`; scaffolding lines have no entry. Temps map to the node that needed them, the `try/catch` lines to the node whose continuation they wrap. Written as `graph-<id>.map.json` in the SWF's build folder and returned by `compileSwf` (`graphClasses`) for the split view and for traces (Phase 6).

## Data bindings and the preview build (Phase 6)

`CodegenInput.bindings` (overlay `dataBinding` strings by layer id) become per-variable bind functions called on init and after every Set Variable; `CodegenInput.preview` (the Ruffle preview SWF only) adds pin value traces (`__g.pv`) and mock data hooks. Details, formats and limits: `docs/debugging.md`. The game build is unchanged by `preview` (test).

## Saved variables and runtime nodes (Phase 5)

In the menu flavour (`menu: true`) a variable with scope `saved` is read in `init()` through `__g.bridge.getSaved` with a `typeof` check against the variable type (default plus a `warn` log on mismatch), and every node whose definition has `extra.writesVariable` (the field naming the variable; a pack copy without it falls back to the Set Variable / Toggle kinds) is followed by `__g.bridge.setSaved("<name>", __g.v_<name>);` before the binding refresh and the continuation. Outside the menu flavour the variable is a plain menu variable. The 12 runtime nodes of core pack 0.3.0 have golden AS2 in `codegen.test.ts` (generated for every kind); the saved goldens are in `menuNodes.test.ts`. Details and the list component: `docs/menus.md`.

## Pipeline

- **`generate` / `compileSwf`** (`graphs` option): classes are added like the layout class (exported as `__Packages.mods.<mod>.<cls>`). Codegen issues become lint errors `graph-codegen` on the root frame (message names the graph and node). Without graphs, or with an empty list, the output is byte-identical to before (test).
- **HUD widgets.** If a graph has an On Widget Call, the widget class has no hardcoded popup API (`setTexts`, `show`, `hide`, fade; the graph does that with Set Text, Set Alpha, Delay...) and the Papyrus script gets one typed function per entry instead (`generateScripts({calls})`): `Function Show(String asTitle, Float afHold, Bool abSticky)` (prefix `as`/`af`/`ab` + capitalised name), `UI.InvokeStringA(..., WidgetRoot + ".<Name>", a)`, a call before the widget is ready is remembered (the last one) and replayed once in `OnWidgetReset`. `Test()` stays and calls the first entry (graph file order: ids sort alphabetically), the debug hotkey calls it too, or with several entries cycles through all of them, one per press (a Bool parameter gives a False and a True step), with sample arguments (strings: `"Inkwell test"`, `"Text 2, ..."`; numbers 4.0; bools True). Names that are not Papyrus identifiers or collide with `Test`, `OnKeyDown`, `Ready`, `X`, `Y`, `Alpha`... throw (deploy shows the message). Without an On Widget Call the old API is generated unchanged.
- **Sync build** (`buildPipeline`, `packDirs`): the game SWF and the Ruffle preview SWF are compiled with the SWF's saved graphs (read from disk each build). Phase 6 only has to run the preview SWF.
- **Deploy** (`DeploySwf.graphs`, `DeployInput.packs`): hudWidget compiles with the graphs; `validateGraph` errors reach the export gate as before.

## Tests

`codegen.test.ts` (golden AS2 per node kind in `__snapshots__`, caching, errors, source map), `codegen.nodes.test.ts` (Random and Counter caching, Toggle bindings, Delay retrigger / Cancel Delay / Stop Timer, Tween registry, Array Get coercion), `templates.integration.test.ts` (every core template compiled by the real FFDec: 97 of the 100 nodes of the bundled pack, the 3 others are editor-only; skipped with a warning without Java/FFDec/wrapper jar), `widget/graphWidget*.test.ts` (samples/hud-graph slice, Papyrus, preview path), `sync/buildPipeline.test.ts`, `deploy/run.test.ts`; the custom-menu glue: `menuGlue.test.ts` (golden AS2) and `menuGlue.integration.test.ts` (real FFDec), `docs/menus.md`.

A passing FFDec compile means the AS2 **parses** and the class is in the SWF. FFDec's compiler does no type checking, and nothing here was run in Ruffle or the game.

## FFDec wrapper change

`com.inkwell.Wrapper` used to ignore scripts FFDec could not parse (it logs SEVERE and leaves the class empty, the SWF still builds). It now fails the job with `AS2 script error: ...`. Rebuild the jar (`yarn build:wrapper`, git-ignored) after pulling.
