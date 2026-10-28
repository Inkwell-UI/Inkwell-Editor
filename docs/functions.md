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

- **Creating:** Navigator > Graphs > `+ Function` (a function graph with one exit "Done", Entry wired to Exit; it is not attached to a layer). **Make Function** (Graph panel toolbar) turns the selected nodes into a function and puts one Call Function node in their place (`shared/functions.ts` `extractFunction`, `state/graphDocs.ts` `makeFunction`; one undo step in the open graph, the function file is created and kept). It is refused, with the reason in a toast and nothing created, when the selection has an event, uses a graph variable, is entered at more than one place, or nothing connects to it.
- **Signature editor:** in the Inspector (`graph/SignatureEditor.tsx`): select the Function Entry node to edit the inputs (name, type), the Function Exit node to edit the outputs (name, type) and the exits (name; at least one). A name is applied on Enter or blur and only when valid (identifier, not reserved, unique; outputs and exits share names), so the file never holds a signature the Spec refuses. Each change is one undo step.
- **Calls follow the signature:** the signature is part of the graph store's document. When it changes (edit, undo or redo) the Function Entry / Exit wires follow their pin by id, and every Call Function node in the SWF's other graphs is refreshed (`syncCalls`, not recorded in their histories: they are derived, and undoing the signature brings them back). A call node's own `function` field is a picker; choosing another function copies that signature and drops the wires of pins that no longer exist (`pointCall`). The copied lists are hidden (`extra.managedFields`).
- **Function Exit** has an exit picker (the signature's exits). The Functions node category has its own colour.

## Verified

- Unit tests: `codegen/functions.test.ts` (generated AS2, frame code, validation). Real FFDec compile of a function and its caller, game and preview flavour: `codegen/functions.integration.test.ts`.
- **Ruffle 0.7.1, 2026-10-28, run by hand:** a caller with two Call Function nodes in a Sequence, both on a function with a Delay named `wait`: both exits fired after one second with their own outputs (`info l1: 1`, `info l2: 2`), no errors. Nothing of this ran in Skyrim's GFx.

## Known limits (v1)

- The UI is untested by eye. Make Function does not pull pure nodes that only feed the selection into the function; they stay outside and arrive as inputs.
- `rn`/`wt` flow-trace sequence numbers (`rc`, `tq`) are per instance, so in a Dev build the order of timer traces across a function and its caller is not global. Preview traces carry node ids without a graph id, so a node id reused in two graphs would be ambiguous (matters for libraries, Phase 2).
- A call placed on two exec paths is emitted twice, like any exec node (`docs/codegen.md`).
- Functions are per SWF; sharing across SWFs is Phase 2 (libraries).
