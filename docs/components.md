# Components

A component is a Figma component that has behaviour: a graph, and props (data the one who creates it can give). Plan and open items: `PLAN-COMPONENTS.md` at the repo root.

## What a component is

- **Visual:** the Figma component. Never edited here. A component kept on the Figma page away from the design is sent by the plugin (`swfs.componentTrees`) and kept in `figma/components/<id>.json`; a component inside a frame is part of that SWF's IR.
- **Behaviour:** a **blueprint graph** (Spec `Graph.scope: "blueprint"`, `component` = the Figma id, `props`), stored in `components/<id>.json` of the project, not in a SWF. The Components tab (Behaviour, left) adds or opens it; the Graph panel shows it. It starts with an On Load, which runs when an instance is created, after its props are set.
- **Props:** `{id, name, type, default}`, edited in the Inspector while nothing is selected. **Get Prop** (`core/GetProp@1`) reads one in the graph (`__g.props["<name>"]`); its output takes the prop's type, and the node its name, from copies the editor keeps current (`propType`, `propName`).
- **Layers:** while a component's graph is open the Navigator lists what the component is made of, and node layer pickers list those layers (`hooks/useComponentIr.ts`).

## At runtime

- Each component that has a graph and sits on the Figma page is compiled into the SWF as a library symbol exported as `inkwell_component_<figma id>` (`generate()` option `components`, `project/componentSources.ts`; custom menus and the preview, built by `sync/buildPipeline.ts`). Its graph is compiled to a class `mods.<modId>.<SwfCls>Graph_<id>` taking `(clip, props, owner)`; missing props get their default, or the zero of their type.
- **Create Component** (`core/CreateComponent@1`): `parent` layer, optional `name`, `props` (an Object keyed by prop **name**, built with Make Object; renaming a prop does not rename the key you typed in Make Object), output `instance` (the new clip). It does `attachMovie(<symbol>, name, getNextHighestDepth())` on the parent, then `new <class>(clip, props, __g).init()`. **Remove Component** removes an instance (`removeMovieClip`).
- A graph inside a component addresses layers by their path inside the symbol (`__g.base.<path>`); a menu graph cannot use a component's layers, and a component's graph cannot use the menu's.
- **Depth:** a runtime instance is drawn above everything Figma placed in the parent (Figma layers have negative depths; `getNextHighestDepth()` starts at 0).
- **Layout:** when the parent picked on Create Component is an auto-layout frame, the instances are stacked in it (`stackAdd` / `stackRemove` in the graph class, `flowAs2.ts`): the frame's direction, spacing, padding and counter-axis alignment, after the children Figma designed. A parent that is wired in is not laid out and does not list its instances.
- **Navigator:** a preview build traces `[Inkwell] spawn <parent layer id> <component id> <clip path>` and `despawn <clip path>`; the Layers list shows those instances under their parent as dashed, italic rows tagged RUNTIME (`withRuntimeRows`, `traceStore.spawned`). They are not layers of the design and clear with the next build.
- Checked in Ruffle 0.7.1 with the real FFDec build: two instances, one with a given prop and one with its default, each ran its On Load. Not run in the game.

## Not built yet

- Components placed in Figma (`instance` nodes) do not run their graph; props from an instance's Figma properties; variants as states; overrides surviving a re-sync.
- A component inside a SWF's own design is drawn where it is, not compiled as a symbol, so Create Component cannot make it; only page components can.
- HUD widgets (`compileWidget`) do not get component symbols.
- Message and mod-event nodes inside a component graph are not dispatched (the menu class only wires the SWF's own graphs).
- Repeaters (one instance per array item).
