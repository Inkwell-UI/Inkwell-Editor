# Debugging graphs: AS2 split view, Play mode, trace (Phase 6 of 0.2)

Everything here runs in the **Ruffle preview, not the game**. In-game trace logs and live inspection need the Inkwell Runtime (0.3); the UI says so (Runtime Trace panel notice, Play panel note). Graph format and codegen: `docs/graphs.md`, `docs/codegen.md`; panel reference: `docs/ui-panels.md`.

## What a graph edit does

`saveGraph` and `deleteGraph` (main, `session.ts`) queue a rebuild of the SWF like an overlay or Figma change does (`server.rebuild`, 100 ms debounce on top of the renderer's 300 ms graph save). The build reads the saved graphs from disk (`buildPipeline.ts`), so the preview SWF carries the new classes. A **mock-data-only** overlay save does not rebuild (`withoutMock` in `session.ts`): mock data goes to the running movie (below). Timing shows in the status bar like any build.

Measured on the `hud-graph` sample (this machine, warm FFDec wrapper, real Electron): a graph edit (typing in a Log field) to the new preview frame: **320 to 340 ms** reported by the status bar (`Sync 4.5 ms, Codegen <1 ms, SWF 11 ms, FFDec 15-19 ms, Preview 60-70 ms, Ruffle 225 ms`), about **850 ms wall clock** from the keystroke (that includes the two debounces and the AS2 view updating). The first build after start is 1.4 s (cold FFDec, 0.7 s).

## AS2 split view (6.1)

`AS2 Split` in the Graph panel header (`graph/As2View.tsx`). It shows the generated class of the open graph, read only: a `<pre>` with line numbers (no code viewer in the repo, no new dependency). The lines of the **selected node** are highlighted from the source map (`model/as2View.ts`), the first one is scrolled into view; **clicking a line** selects its node and pans the canvas to it (`selectionStore.revealGraphNode`, `reveal`). Lines of the class scaffolding are not clickable.

The code comes from IPC `graphAs2(swf, graph)`: main runs `generate()` (codegen only, no FFDec, game flavour: no preview extras) for the graph **as it is in the editor now** next to the SWF's other saved graphs. The view asks again 250 ms after the graph changed (a string key of the graph, so selecting nodes does not regenerate); the last good code stays visible while a request is pending or failed. A skipped node shows as its `// [id] skipped: ...` comment.

## Play panel and the preview bridge (6.2)

Dock tab `Play` (Behaviour mode): pick an **On Widget Call** entry of the SWF's graphs, fill its typed parameters, **Call**. The preview movie runs the same clip method Papyrus runs in game, with the arguments as one string array (`model/playEntries.ts` `callArgs`: numbers in plain notation, `true`/`false`). The panel is disabled with a reason when this window has no running preview (the preview popped out into its own window).

Mechanism (**ExternalInterface**, preview SWF only): `swf/generate.ts` `PREVIEW_BRIDGE` registers callbacks at the start of the preview's frame code; `RuffleBackend` loads the movie with `allowScriptAccess: true` (it is our own generated SWF) and Ruffle exposes each callback as a method of the player element. Panels reach the backend through `preview/previewBus.ts` (panels do not import each other; `PreviewPanel` attaches its backend).

| callback | does |
| --- | --- |
| `inkwellCall(name, args)` | `_root[name].call(_root, args)`: the On Widget Call's clip method; false when there is none |
| `inkwellMockReset()`, `inkwellMock(key, value)`, `inkwellMockDone()` | replace `_global.Inkwell.mock`, then let the graph classes re-read it |
| `inkwellGet("Hud.title.text")` | reads a value from the movie by path from `_root` (debugging and test aid; the screenshot driver uses it) |

### Mock data

The Mock Data panel's key/value list (overlay `mockData`) is delivered by `preview/mockDelivery.ts` after every load of the movie (a rebuild restarts it) and whenever the data changes (`PreviewPanel`). The graph classes of the **preview build** read it:
- a graph variable whose **name** equals a mock key takes its value (Number/String/Bool, coerced) and its bindings are re-applied;
- `mock:<key>` bindings (below) set the bound property.

Mock data is never part of the game SWF, never shipped. Removing a key re-delivers the list without it, but a variable keeps the last value it had.

## Data binding codegen (6.2)

The overlay `dataBinding` string (`shared/graphBinding.ts`: `text=var:score;alpha=mock:hp`) is compiled by the **graph class** (so a layer needs a graph; `generateGraphClasses({bindings})`, filled from the overlay by `buildPipeline` and `compileWidget`):
- `var:<id>` (a variable of that graph): `__g.b_<name> = function() { try { <layer>.<prop> = ... } catch (e) { __g.fail("binding:<name>", e); } }`, called **once on init** (after the variables are set) and **after every Set Variable** of that variable (the `emit` of a `core/SetVariable@` node adds `__g.b_<name>();` before its continuation, so the template in the Core-Pack is untouched). Several properties on one variable share one function.
- Property code: `text` = `String(x)`; `visible` = `(x == true || x == "true")`; `alpha` = `Number(x)` (0..100, Flash native); `tint` = `new Color(clip).setRGB(Number(x))`.
- `mock:<key>`: preview build only, in the first graph class of the SWF (see Mock data). Keys that are not identifiers (`hp.max`) go through brackets.
- A binding whose layer is not compiled, or whose variable is not in this graph, generates nothing (the Data Binding panel already warns).

## Trace output (6.3)

**Channel: the page console.** Ruffle 0.7.1 (pinned exactly) has no log API and `trace()` is an AS2 *statement* (it cannot be overridden by a shim), so the lowest-effort channel is what Ruffle already does: it writes each `trace()` as `console.log('%cINFO%c web/src/log_adapter.rs:18%c <text>', css, css, css)`. `RuffleBackend` wraps `console.log/info/debug` once and takes the text after the `log_adapter.rs` target (`traceTextOf`; a bare line containing `[Inkwell]` also counts); Ruffle is started with `logLevel: 'info'` (avm traces are info level). Nothing is sent over IPC. If a Ruffle upgrade changes the console format, `preview/traceText.test.ts` documents what was assumed; the fallback is an `ExternalInterface.call` shim in the generated `fail`/Log code.

Line formats (`model/traceParse.ts`, from codegen): `[Inkwell] <info|warn|error> <nodeId>: <message>` (Log node, handler failure) and `[Inkwell] pin <nodeId>.<pin> = <value>` (preview only). Other trace lines show as plain `TRACE`.

**Runtime Trace panel** (`panels/TracePanel.tsx`, `state/traceStore.ts`): time (`[HH:MM:SS.mmm]`, when the editor received the line), level, the node's title and id, message; colours for warn/error; "Warnings and errors only"; **Clear Trace**; the last 500 lines. Clicking a line whose node id is in one of the active SWF's graphs opens that graph and selects the node (`state/graphReveal.ts` `openGraphNode`). Notice shown: "Ruffle preview, not the game; in-game traces need the Runtime (0.3)". Trigger Hot Reload and the variable watch stay greyed (runtime).

**Live pin values.** In the **preview build** (`preview: true` in codegen) every pure node's first output is wrapped as `__g.pv("<node>", "<pin>", <expr>)` and an On Widget Call traces its parameters at the start of the handler. `pv` traces the value (strings quoted, newlines escaped) and returns it, so behaviour is unchanged. The trace store keeps the last value per `node.pin` (cleared when a new build loads) and the node shows it as a small badge on the output pin (`gn-pin-val`, tooltip "Last value in the Ruffle preview"). **Not traced:** outputs of other exec nodes (a For Each `item`, a Delay) because their locals are only in scope inside their own continuation; Log shows in the trace panel instead. The game build has none of this code (test: `codegen.debug.test.ts`).

### A deliberate runtime error

Every handler body is `try { ... } catch (e) { __g.fail("<entry id>", e); }`; `fail` accepts a string or `{node, message}` and traces `[Inkwell] error <node>: <message>` (the throwing node when it threw `{node, ...}`). The core pack has **no node that throws**, so the check uses a test-only `core/Throw@1` (`tests/fixtures/packs/throw-node`: `throw { node: "<id>", message: <in> };`). Covered at three levels: `codegen.debug.test.ts` (shape of the try/catch, one per entry, `fail` names the node), `widget/graphDebug.integration.test.ts` (real FFDec compiles it), and the Ruffle run below (the failing node id is traced and the widget keeps working afterwards). Proposal for the Core-Pack (another repo): a Debug `Throw` node, so the owner can run the check in game.

## Lint rows open the graph (6.4)

The selection store carries the graph id of the selected node (`SelectionState.graph`). A Lint dock row of a graph issue (`graphId`/`graphNodeId`) activates the SWF and that graph, switches to the Behaviour mode if needed, selects the node and the canvas centres it (`state/graphReveal.ts`, `selectionStore.reveal`). The component the issue names (if any) is selected too.

## Verifying (what was run)

Unit and integration tests: `yarn test`. End to end in the real preview: `INKWELL_SHOTS_GRAPH=debug` (`docs/ui-panels.md`, Debug) on a scratch copy of `samples/hud-graph` and a copy of `resources/packs/core` plus the Throw fixture (`INKWELL_CORE_PACK`). It rewrites the copy's graph (adds `Boom`, a variable `greeting` bound to the subtitle, Set Variable after the Log) and overlay (binding, mock data), then prints OK/FAILED per check and saves `d0-start` to `d9-lint-click`. Observed (Ruffle 0.7.1 in Electron 45):
- before any call the movie's title text was `"INKWELL WIDGET TEST"` and the subtitle `"Mock says hi"` (variable `greeting` bound to the subtitle, mock key `greeting`); after the Play panel called `Show("Hello Ruffle")` both read `"Hello Ruffle"` (Set Text, then Set Variable and its binding), the preview showed it (`d4b-zoomed-widget.png`), the trace panel got `[HH:MM:SS.mmm] INFO Log #log shown`, and the canvas showed pin badges `"Hello Ruffle"` (On Widget Call title) and `true` (Compare);
- `Boom` traced `ERROR Throw #throw deliberate error`; calling `Show("Still alive")` afterwards worked and logged again;
- clicking a trace line, an AS2 line, or a Lint row selected the node; the AS2 view followed a field edit in 330 ms.

## Limits

- The Play panel, mock delivery and trace need the preview in the same window (detached preview: not wired; the overlay in the pop-out window does not see edits made in the main window either).
- Ruffle logs `Avm1::pop: Stack underflow` twice at load of a graph movie (once already without graphs, so before this phase); the behaviour checked above is correct. Not investigated.
- The trace channel is tied to Ruffle's console format (pinned version).
- Bindings run inside graph classes only; a project without a graph does not bind. `mock:` bindings only exist in the first graph class of a SWF.
- `inkwellCall` runs methods on `_root`: in the preview a HUD widget previews as its design frame, so the clip method sits on the main timeline there (in game it is on the `widget` clip).
