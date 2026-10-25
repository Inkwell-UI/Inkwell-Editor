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
- `yarn compile:images [--deploy]`: the in-game image test (embedded menu `[`, dds menu `]`) into `build/image-test/`; `--deploy` copies it into the MO2 mod `Inkwell Spikes` (`INKWELL_IMAGE_DEPLOY` overrides; never a game Data folder). See `docs/images.md`.
- `yarn compile:widget`: compiles `samples/hud-widget` to the mod folder `build/widget-test/` (SWF, generated Papyrus, .pex, ESP). `INKWELL_PAPYRUS` = path to the user's russo `papyrus.exe` (never bundled; header stubs in `resources/papyrus-stubs/`). `yarn deploy:widget` copies it into the MO2 mod `Inkwell Widget Test`. See `docs/hud-widget.md`.
- Setup Doctor and Deploy (phase 2): settings live in `<userData>/settings.json`; `INKWELL_FFDEC`, `INKWELL_JAVA`, `INKWELL_PAPYRUS`, `INKWELL_SKYRIM`, `INKWELL_MO2_MODS`, `INKWELL_MO2_OVERWRITE`, `INKWELL_FIGMA_MANIFEST` and `INKWELL_CK_SOURCES` override them. `yarn test` runs the doctor against this machine (read-only) and a real widget deploy into a temp folder (needs Java, FFDec and the wrapper jar). Graph UI screenshots: `INKWELL_SHOTS_GRAPH=1` (`docs/ui-panels.md`, Debug). Debug screenshots of both UIs: `INKWELL_SHOTS_SETUP=1 INKWELL_SHOTS_DIR=<dir> INKWELL_SHOTS_PROJECT=<scratch copy of samples/hud-widget> INKWELL_MO2_MODS=<a folder you may overwrite>` plus a separate `--user-data-dir`; it really deploys. Setup Doctor field/browse driver: `INKWELL_DOCTOR_DRIVER=1` (see `docs/setup-doctor.md`, Debug driver). Package Mod and the Deploy menu's Vortex row save the same files as one zip (same planner and export gate; default `<project>/dist/<Name>-<version>.zip`, git-ignored; `INKWELL_SHOTS_PACKAGE_DIR` answers the save dialog in screenshot runs). See `docs/setup-doctor.md` and `docs/deploy.md`.
- Install Skyrim fonts for Figma (Settings > Fonts for Figma, opt-in): `src/main/fonts` extracts the game's fonts with FFDec, renames them (Everywhere Light/Medium/Bold, one family per other face) and installs them per user (HKCU + `%LOCALAPPDATA%\Microsoft\Windows\Fonts`) with a manifest. Tests never touch the real registry or font folder; manual runs use `INKWELL_FONTS_SANDBOX=<dir>` (screenshots: `INKWELL_SHOTS_FONTS=1`). See `docs/font-install.md`.
- `yarn dev` also starts the Figma sync server (127.0.0.1:8787-8790, session token shown in the window). Env: `INKWELL_FFDEC`, `INKWELL_JAVA`, `INKWELL_PROJECT`. See `docs/sync-server.md` for the manual test with the Figma plugin. Each sync also keeps `figma/snapshot.json` (provenance and a hash tree root per SWF; builds use `ir.json` + `assets/`, so a project builds offline): `docs/sync-server.md`, Figma snapshot.
- `yarn sync:core-pack` copies `../Inkwell-Core-Pack` (manifest, nodes, templates) into `resources/packs/core`, the pack the editor loads by default. Run it after changing the Core-Pack; commit the copy.
- Spec package: `@inkwell-ui/spec` is `link:../Inkwell-Spec` (a link to the sibling checkout, not a copy; specVersion 5, protocol 3). After changing the Spec, run `yarn build` in `Inkwell-Spec`; nothing needs reinstalling here. The sibling checkout must exist next to this repo.

**Next milestone:** the 0.2 (visual scripting) plan, with start-here instructions for a new session, is `PLAN-0.2.md` in the workspace root (`D:\Mods\Inkwell`, next to `Inkwell Design Spec.md`). Read it before starting 0.2 work.

Run test + typecheck before finishing any change. `electron` downloads its binary in a postinstall; if `yarn dev` says "Electron uninstall", run `node node_modules/electron/install.js`.

Layout: `src/main` (Electron main, `project/` = project.json + folder load/save + `graphFiles.ts`, `packs/` = pack loader; graph data layer, packs, store and validation: `docs/graphs.md`; `codegen/` = graph to AS2 renderer, source maps and pack templates: `docs/codegen.md`), `src/renderer` (React; `graph/` = the Knotwork canvas, node view, field editors, Graphs list; `model/graphModel.ts` = pin look, connection rules, spawn and field logic; `state/graphDocs.ts` = which graphs a SWF has; all UI strings in `strings.ts`, all colors in `theme.css`; panels, hooks, workspace layout and preview pieces: see `docs/ui-panels.md`; zones, workspaces, stores and the selection model: `docs/ui-shell.md`), `src/shared` (`product.ts` holds the product name; `timing.ts` stage timer). `samples/hud-minimal` is the golden sample project.

## Stack

Electron, React, React Flow, Knotwork (`@nicklaj/knotwork`, pinned to a GitHub tag), Zustand + zundo, Zod, Vite, Vitest. Shared formats come from `inkwell-spec`.

## Rules that are easy to break

- **One SWF per top-level Figma frame** (`swfs/<name>/`, `build/<name>.swf`); one project = one mod = several SWFs. Loose top-level layers are linted `unreachable-node`; swfs of deleted frames are orphaned, never deleted.
- **Figma owns visuals.** Never edit the visual IR in the editor. Behavior (scripts, roles, anchoring overrides, bindings, instance names, focus) lives only in the overlay, keyed by Figma node ID.
- **Shared formats are defined in inkwell-spec.** Never define or change the IR, sync protocol, debug protocol, menu JSON/INI or pack manifest here; change the spec first, then consume the new version.
- **Never drop unknown data:** IR `extra`, nodes from missing packs, unknown contract entries all survive load and save.
- **One validation source:** issues are computed once, pinned to graph nodes and Figma node IDs; components read them, never recompute.
- **Graphs** (`swfs/<name>/graphs/<id>.json`): validated by `src/shared/graphValidate.ts` only (main for the Lint dock and export gate, renderer through Knotwork `createValidation` for badges); a node targeting a deleted Figma layer is an orphan, never dropped; the SWF's one undo history orders overlay and graph edits (`state/swfHistory.ts`). See `docs/graphs.md`.
- **Graph UI edits only through store actions** (`graphStore`, `editNode`/`editOverlay`): a drag is one entry, a spawn with its wire is one entry, attaching or deleting a graph edits the overlay `scripts` in the renderer. Data bindings are one `dataBinding` string per layer (`shared/graphBinding.ts`) and mock data lives in the overlay document's `mockData`; both join the SWF's undo history. See `docs/graphs.md`, Graph UI.
- **Generic graph code belongs in Knotwork.** If a change isn't Inkwell-specific (indexes, rules, undo, spawn menu, clipboard, navigation), make it in the Knotwork repo and bump the pinned tag.
- **No per-node scans** of node or edge arrays; use Knotwork's indexes. Only visible graph nodes are mounted.
- **Generated AS2 is readable and source-mapped** to node IDs (`src/main/codegen`, `docs/codegen.md`; a graph class is not declared `dynamic` because FFDec's AS2 compiler cannot parse it). Classes are namespaced `mods.<modId>.*`; translation keys `$Inkwell_<Mod>_…`.
- **Errors never crash a menu:** generated code coerces node outputs to pin defaults and wraps each event handler in `try/catch` that logs the node ID.
- **Pure nodes are cached per dependency scope** (per event run, or per loop iteration when they depend on the loop element); volatile reads (Get Variable, Get Text, and anything fed by them) are never cached. Tests in `codegen.test.ts`.
- **The FFDec wrapper fails a build when an AS2 script does not parse.** Rebuild the jar (`yarn build:wrapper`) after pulling; the template test (`templates.integration.test.ts`) compiles every core template with it.
- **No JavaScript from node packs runs in the editor.** Packs are declarative; load them as data.
- **Author-owned config is JSON; end-user-owned config is INI.** The editor generates both, plus a commented default INI per mod.
- **Local servers need a session token and origin checks** (Figma bridge, runtime debug connection). Bind to localhost only.
- **Never ship or export Bethesda's vanilla SWFs.** Extract from the user's install into a per-game-version cache; git-ignore it; refuse to export unmodified vanilla files.
- **Images follow the project's `imageMode`:** `embedded` (default) compiles bitmaps into the SWF; `dds` loads `img://textures/Inkwell/<modId>/<hash>.dds` at runtime and deploys the DDS files. The preview always embeds (Ruffle has no `img://`). Asset hashes become file names: validate them (`AssetHash`). Which mode works in Skyrim's GFx is unverified (`docs/images.md`).
- **Never touch `fontconfig.txt`;** embed custom fonts in the mod's own SWF.
- **Extracted game fonts stay on the user's machine:** the font tool installs them per user only (never HKLM or `C:\Windows\Fonts`), never overwrites fonts it did not install, and nothing extracted is ever written into a project, build, deploy or the repo.
- **FFDec is user-installed** and driven as a separate process. Never bundle it. A cold FFDec run takes about 2.4 s, so builds go through a resident wrapper (a separate component on `ffdec_lib.jar`, LGPL, pinned to an FFDec version) that takes jobs over stdin/stdout.
- **Text compiles to `DefineEditText` with a font id and outlines**, importing the alias font from `gfxfontlib.swf` (`ImportAssets2`), as vanilla menus do. Never `fontClass` or device fonts: they draw nothing in Skyrim.
- **The Ruffle preview uses its own SWF** (`<name>.preview.swf`: text with embedded glyph outlines of the preview font (device font only without font bytes), fonts and glyph embedding in `docs/preview-fonts.md`; no `ImportAssets2`), because Ruffle cannot load `gfxfontlib.swf`. The game SWF never uses it. UI panels take no props and import no other panel; layouts are data (`docs/ui-panels.md`).
- **Generated AS2 stays at Flash 8 level.** `try/catch` works, but there is no `Error` class (throw strings or plain objects), and AS2 runtime `flash.filters` is unavailable.
- **The Papyrus compiler is user-pointed, not bundled.** Header stubs are written from scratch and must match real declarations (full properties vs `auto`); wrong stubs compile silently to broken code.
- **SkyUI widgets need two scripts** (the widget and an empty `...Instance` that extends it), the SWF in `Interface/exported/widgets/<mod>/`, and a root clip named `widget`. Never bundle SkyUI files (no license).
- **Measure every build stage** (sync, codegen, FFDec, preview) and keep the preview behind the pluggable preview interface; Ruffle is the only 1.0 implementation.
- **Skyrim translation files** use full language names and the game's expected encoding; cover the exporter with tests.
- **Editor UI is English only in 1.0**, but all UI strings live in one module.
