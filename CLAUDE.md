# Inkwell Editor

Electron desktop app that turns Figma designs into Scaleform SWFs for Skyrim SE/AE, with live Figma sync and a visual scripting graph that transpiles to AS2. The full design is in `Inkwell Design Spec.md` (workspace root); read the relevant section before changing behavior. Where this file and the spec disagree, the spec wins; fix this file.

## Commands

Not scaffolded yet. When they exist, list them here (dev, test, typecheck, build) and run test + typecheck before finishing any change.

## Stack

Electron, React, React Flow, Knotwork (`@nicklaj/knotwork`, pinned to a GitHub tag), Zustand + zundo, Zod, Vite, Vitest. Shared formats come from `inkwell-spec`.

## Rules that are easy to break

- **Figma owns visuals.** Never edit the visual IR in the editor. Behavior (scripts, roles, anchoring overrides, bindings, instance names, focus) lives only in the overlay, keyed by Figma node ID.
- **Shared formats are defined in inkwell-spec.** Never define or change the IR, sync protocol, debug protocol, menu JSON/INI or pack manifest here; change the spec first, then consume the new version.
- **Never drop unknown data:** IR `extra`, nodes from missing packs, unknown contract entries all survive load and save.
- **One validation source:** issues are computed once, pinned to graph nodes and Figma node IDs; components read them, never recompute.
- **Generic graph code belongs in Knotwork.** If a change isn't Inkwell-specific (indexes, rules, undo, spawn menu, clipboard, navigation), make it in the Knotwork repo and bump the pinned tag.
- **No per-node scans** of node or edge arrays; use Knotwork's indexes. Only visible graph nodes are mounted.
- **Generated AS2 is readable and source-mapped** to node IDs. Classes are namespaced `mods.<modId>.*`; translation keys `$Inkwell_<Mod>_…`.
- **Errors never crash a menu:** generated code coerces node outputs to pin defaults and wraps each event handler in `try/catch` that logs the node ID.
- **Pure nodes are cached per dependency scope** (per event run, or per loop iteration when they depend on the loop element).
- **No JavaScript from node packs runs in the editor.** Packs are declarative; load them as data.
- **Author-owned config is JSON; end-user-owned config is INI.** The editor generates both, plus a commented default INI per mod.
- **Local servers need a session token and origin checks** (Figma bridge, runtime debug connection). Bind to localhost only.
- **Never ship or export Bethesda's vanilla SWFs.** Extract from the user's install into a per-game-version cache; git-ignore it; refuse to export unmodified vanilla files.
- **Never touch `fontconfig.txt`;** embed custom fonts in the mod's own SWF.
- **FFDec is user-installed** and driven as a separate process. Never bundle it.
- **Measure every build stage** (sync, codegen, FFDec, preview) and keep the preview behind the pluggable preview interface; Ruffle is the only 1.0 implementation.
- **Skyrim translation files** use full language names and the game's expected encoding; cover the exporter with tests.
- **Editor UI is English only in 1.0**, but all UI strings live in one module.
