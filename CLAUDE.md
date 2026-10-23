# Inkwell Editor

Electron desktop app that turns Figma designs into Scaleform SWFs for Skyrim SE/AE, with live Figma sync and a visual scripting graph that transpiles to AS2. The full design is in `Inkwell Design Spec.md` (workspace root); read the relevant section before changing behavior. Where this file and the spec disagree, the spec wins; fix this file.

## Commands

Use yarn (not npm).

- `yarn dev`: Electron + Vite dev window.
- `yarn build`: production build to `out/`.
- `yarn test`: Vitest (`src/**/*.test.ts`).
- `yarn typecheck`: `tsc --noEmit`, strict.
- `yarn build:wrapper`: compiles `tools/ffdec-wrapper` to `build/ffdec-wrapper.jar` (git-ignored). Needs a JDK 9+ (portable Temurin 17 in `C:\dev\jdk`, outside the repo, or set `INKWELL_JDK`); `--release 8` so the jar runs on the user's JRE. The FFDec integration test needs `java` on PATH (or `INKWELL_JAVA`) and skips unless FFDec and the jar exist. See `docs/ffdec-wrapper.md`.

- `yarn compile:sample`: compiles `samples/hud-minimal` to `build/sample.swf` (git-ignored) through `src/main/swf` and the wrapper, for in-game testing. Needs the same Java/FFDec/jar as above. See `docs/swf-compiler.md`.
- `yarn compile:widget`: compiles `samples/hud-widget` to the mod folder `build/widget-test/` (SWF, generated Papyrus, .pex, ESP). `INKWELL_PAPYRUS` = path to the user's russo `papyrus.exe` (never bundled; header stubs in `resources/papyrus-stubs/`). `yarn deploy:widget` copies it into the MO2 mod `Inkwell Widget Test`. See `docs/hud-widget.md`.
- `yarn dev` also starts the Figma sync server (127.0.0.1:8787-8790, session token shown in the window). Env: `INKWELL_FFDEC`, `INKWELL_JAVA`, `INKWELL_PROJECT`. See `docs/sync-server.md` for the manual test with the Figma plugin.
- Spec package: `@inkwell-ui/spec` is `file:../Inkwell-Spec` (sibling checkout, branch feat/swf-per-frame, specVersion 3, protocol 2). Run `yarn build` there if its `dist` is missing or stale, then `yarn install --force` here to re-copy it.

Run test + typecheck before finishing any change. `electron` downloads its binary in a postinstall; if `yarn dev` says "Electron uninstall", run `node node_modules/electron/install.js`.

Layout: `src/main` (Electron main, `project/` = project.json + folder load/save), `src/renderer` (React; all UI strings in `strings.ts`), `src/shared` (`product.ts` holds the product name; `timing.ts` stage timer). `samples/hud-minimal` is the golden sample project.

## Stack

Electron, React, React Flow, Knotwork (`@nicklaj/knotwork`, pinned to a GitHub tag), Zustand + zundo, Zod, Vite, Vitest. Shared formats come from `inkwell-spec`.

## Rules that are easy to break

- **One SWF per top-level Figma frame** (`swfs/<name>/`, `build/<name>.swf`); one project = one mod = several SWFs. Loose top-level layers are linted `unreachable-node`; swfs of deleted frames are orphaned, never deleted.
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
- **FFDec is user-installed** and driven as a separate process. Never bundle it. A cold FFDec run takes about 2.4 s, so builds go through a resident wrapper (a separate component on `ffdec_lib.jar`, LGPL, pinned to an FFDec version) that takes jobs over stdin/stdout.
- **Text compiles to `DefineEditText` with a font id and outlines**, importing the alias font from `gfxfontlib.swf` (`ImportAssets2`), as vanilla menus do. Never `fontClass` or device fonts: they draw nothing in Skyrim.
- **Generated AS2 stays at Flash 8 level.** `try/catch` works, but there is no `Error` class (throw strings or plain objects), and AS2 runtime `flash.filters` is unavailable.
- **The Papyrus compiler is user-pointed, not bundled.** Header stubs are written from scratch and must match real declarations (full properties vs `auto`); wrong stubs compile silently to broken code.
- **SkyUI widgets need two scripts** (the widget and an empty `...Instance` that extends it), the SWF in `Interface/exported/widgets/<mod>/`, and a root clip named `widget`. Never bundle SkyUI files (no license).
- **Measure every build stage** (sync, codegen, FFDec, preview) and keep the preview behind the pluggable preview interface; Ruffle is the only 1.0 implementation.
- **Skyrim translation files** use full language names and the game's expected encoding; cover the exporter with tests.
- **Editor UI is English only in 1.0**, but all UI strings live in one module.
