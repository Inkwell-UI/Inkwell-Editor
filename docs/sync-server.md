# Figma sync server (`src/main/sync`)

A `ws` server in the Electron main process, started on app ready and closed on quit. Protocol and IR types come from `@inkwell-ui/spec` (`PluginMessage`, `ackHello`, `applyPatch`, `hashNode`).

- Binds `127.0.0.1` only, first free port of 8787-8790 (the plugin tries the same range).
- **Approve-on-connect (protocol 4, design spec Security, SPEC-CHANGES K).** No token. 403 for any `Origin` other than `null` (Figma plugin iframes) or absent; that check only filters real web pages (any sandboxed iframe also sends `null`), so the defence is the user's approval of the plugin's secret. The `hello` carries `pluginSecret` (the plugin's 64-hex random credential, kept in `figma.clientStorage`) and `fileName`. The trust logic is `figmaTrust.ts` (`createTrust`), owned by the session (not the server), so a denial and the prompt limit survive opening another project:
  - **Known secret** (its SHA-256 is in the user settings): `helloAck` at once, no prompt. Hashes are compared in constant time (`timingSafeEqual`, over every stored hash, no early exit).
  - **Unknown secret:** the editor answers `pending` and asks the window (`SyncUiState.approval` = `{id, pluginVersion, fileName, origin}`; the modal "A Figma plugin wants to connect: Allow?" with Allow / Deny; Escape or the close button = Deny). Allow stores the SHA-256 (`figmaPlugins` in `<userData>/settings.json`, never the secret, never in the project) and sends `helloAck`; Deny sends `denied {reason: 'denied'}`, closes, and the secret is refused (same reply, no prompt) until the editor quits.
  - **A pending socket can send nothing else:** any message closes it and withdraws the prompt. After 60 s (`PENDING_TIMEOUT_MS`) it gets `denied {reason: 'timeout'}` and is closed (not a denial: the same plugin may ask again). If the socket closes first, the prompt disappears.
  - **One prompt at a time, at most one per minute** (`PROMPT_GAP_MS`, from the start of the previous prompt): an unknown secret that arrives sooner gets `denied {reason: 'busy'}` and is closed (nothing is queued; the plugin retries with backoff).
  - A protocol or spec mismatch is refused before any prompt (`helloAck {ok:false}`, closed); an older plugin whose `hello` lacks the secret still gets the "Update the plugin" message.
  - Settings > "Forget all Figma plugins" (with a confirmation) removes every stored hash and drops the open connections (`dropAll`).
  - The plugin must wait for `helloAck` before sending anything else.
- **Select / Focus in Figma (protocol 5):** `selectNode(nodeId, focus)` sends `{type:'selectNode', nodeId, focus}` to every approved (post-`helloAck`) socket and returns how many; 0 = nobody connected (the window has the buttons disabled then). A protocol 4 plugin is refused by `ackHello` ("Update the plugin"). The plugin answers nothing.
- Invalid JSON, unknown or invalid messages get an `error` message; the socket stays open. A `PatchError` becomes `error {code, message, nodeId}` and the store is unchanged.
- `hello` -> `pending`? -> `helloAck` (`ackHello`) or `denied {reason}`; a protocol or spec mismatch sends the error and closes.
- **Images (protocol 3):** after a patch or hash tree the server sends `needAssets` for image hashes the project lacks (once per hash per connection) and stores each `asset` reply in `assets/<hash>.png`, then rebuilds the SWFs that use it. See `docs/images.md`.
- **One SWF per top-level Figma frame.** The server keeps one store per swf, keyed by the frame's node id (`patch.swfId`, protocol 2). Swfs of `INKWELL_PROJECT` (`swfs/<name>/ir.json`) are loaded by their `ir.id`; a new swf starts empty with `root = swfId`. `patch.swf` metadata (`name`, `stage`, `target`) sets the stage size and the swf name: the sanitized frame name (`A-Za-z0-9._-`, other runs become `_`), made unique case-insensitively (`Menu`, `Menu_2`), and never renamed by case alone. Folder `swfs/<name>/`, output `<project>/build/<name>.swf`; a renamed frame moves its folder and overlay.
- `hashTree {swfId}`: nodes missing or with a different `hashNode` get a `resend {swfId, ids}`. Nodes the plugin no longer has are kept, not deleted.
- `swfs {frames, loose, components, componentTrees}` (plugin -> editor, on connect and when the page's top level changes; `components` lists the COMPONENT and COMPONENT_SET layers kept on the page away from the design, `componentTrees` holds what each is made of: the editor keeps them in `figma/components/<id>.json`, and a changed tree rebuilds every SWF; `docs/components.md`): a known swf whose frame is missing is **orphaned** (kept, never built, never deleted; the window counts it, the plugin gets an `orphaned-swf` warning). A patch that removes a swf's root is treated the same and the last IR is kept. Loose top-level layers (anything but a FRAME directly on the page) belong to no swf: `unreachable-node` warning "this layer is not inside an exported frame", sent as a project-level `status` (no `swfId`). A node inside a swf that no root reaches gets the same warning in that swf's build status.
- Builds are debounced and run one swf at a time (one resident FFDec wrapper). `status` carries `swfId`; the plugin rolls them up (error beats compiling beats synced).
- After a patch, a 100 ms debounce, then `onChange(swfId, ir, name)` for each touched swf; the plugin gets `status` `compiling`, then `synced` (or `error` when a lint issue has severity `error` or the hook throws).
- `buildPipeline.ts` is the default `onChange`: stages `sync` (save IR), `codegen`, `swf`, `ffdec` via `compileSwf` and the resident wrapper; lint issues go out as `status.issues` (with `severity`). Output: `<project>/build/<name>.swf` (git-ignored), or `<userData>/build` without a project.
- Server options added for the UI: `strict()` (Strict Mode: warnings become errors in the status), `rebuild(swfId)` / `rebuildAll()` (Build All, overlay saves). Events `handshakeFailed` (version/spec mismatch message) and `rejected` (`'origin'`) tell the UI why the plugin could not connect (amber / red Figma dot). `main/session.ts` restarts the server on the same port when another project is opened. The server option `trust` is required (`createTrust({store, ask})`).
- The window (the Figma popover, Inspector, dock and status bar now) shows, for the latest build of each swf (kept per swf id, so frames never overwrite each other): a **Fonts** table (swf, layer, Figma `family/style`, text style name, resolved Skyrim alias or `unmapped`, and how: `text style` | `family/style` | `fallback` | `unmapped`) and a **Lint** list (errors first; severity, code, message, swf, layer name). `compileSwf` returns the fonts as `fonts`; they are not lint issues and not in the lint count.

## Figma snapshot (`src/main/project/snapshot.ts`, design spec "Project format")

The project builds and deploys without Figma from what the sync already stores: the visual IR in `swfs/<name>/ir.json` and the images in `assets/<hash>.png`. `figma/snapshot.json` records where that came from, so a project opened offline says what it is built from:

| Key | Content |
| --- | --- |
| `schema` | `1` |
| `specVersion`, `protocolVersion` | of the editor that wrote it |
| `source` | `{pluginVersion, fileKey?}` from the plugin's last `hello` (absent until a plugin connected; kept when a later write has none). Never the plugin secret. The protocol has no page id or name, so none is stored. |
| `swfs.<folder>` | `frameId` (the top-level frame's node id = swfId), `frameName` (the Figma name), `rootHash` (`treeHash`: `hashNode` over the map node id -> `hashNode(node)`, the same per-node hashes the plugin's `hashTree` sends), `nodes` (count), `assets` (image hashes it uses, sorted) |
| `missingAssets` | referenced images not in `assets/` yet (absent when none) |
| `updatedAt` | ISO time of the last change of anything above |

- **Written** by the build pipeline right after `ir.json`, in the same project lock, atomically (temp + rename), sorted keys (`stableStringify`). It is rewritten only when its content (all but `updatedAt`) changed, so an offline Build All, a rebuild or an unchanged sync cause no git churn. The server debounces patches (100 ms) before the pipeline runs, so a sync burst writes it at most once per SWF build. A failed write is a `snapshot-write-failed` warning; the build goes on (`ir.json` is already saved).
- **Read on open** (`session.ts`): missing = no snapshot (older projects; the next sync writes one), corrupt or invalid = reported in the Figma popover and ignored. Each SWF's `rootHash` is compared with its `ir.json`; a mismatch (hand edit, git merge) is listed as stale in the popover. Builds always use `ir.json`.
- **Reconnect:** the server's store is loaded from `ir.json`, so the plugin's `hashTree` after `hello` gets a `resend` of only the nodes that differ (protocol unchanged; the snapshot's `rootHash` is the root of exactly those per-node hashes). No protocol or spec change was needed.
- **UI:** with no plugin connected the Figma dot reads `Disconnected (Using Snapshot)` when a usable snapshot exists, else `Disconnected`; the preview banner is the UX 5.4 text ("Working from the Figma snapshot. ...") or, without a snapshot, "Not connected to Figma, and this project has no Figma snapshot yet. ...". The Figma popover shows the snapshot (time, SWFs, plugin, stale SWFs or the read error).
- The samples carry a snapshot (no `source`); a test checks it matches their `ir.json`.
- Tests: `project/snapshot.test.ts` (content, root hash, stable bytes, no churn, corrupt/invalid/missing, unknown keys kept, stale, samples), `sync/buildPipeline.test.ts` (offline build of `samples/hud-widget` from disk with no server writes the snapshot once, plugin recorded), `sync/syncServer.test.ts` (hello event, reconnect gets an empty resend for an unchanged tree and only the changed node otherwise), `sync/figmaApproval.test.ts` (pending, nothing accepted before Allow, deny, 60 s timeout with fake timers, one prompt per minute, persisted secret skips the prompt, no plaintext secret, 403, old plugin), `renderer/model/connection.test.ts` (label states). Screenshots: `INKWELL_SHOTS_SNAPSHOT=1` with the `INKWELL_SHOTS_DIR` driver (`l1`..`l5`, see `src/main/screenshotDriver.ts`; it deletes and edits files in the scratch project).

## Config

| Env | Default |
| --- | --- |
| `INKWELL_FFDEC` | `C:\Program Files (x86)\FFDec` |
| `INKWELL_JAVA` | `java` |
| `INKWELL_PROJECT` | unset: the start screen shows (New/Open/Example); with a project open the IR is saved there |

The wrapper jar comes from `yarn build:wrapper`. If FFDec or the jar is missing the server still starts and every build reports an `error` status with a clear message.

## Manual end-to-end test (Figma desktop)

1. In `Inkwell-Spec` run `yarn build`; in `Inkwell-Figma` run `yarn build` (the spec is linked, not copied).
2. Here: `yarn build:wrapper` once, then `yarn dev` (optionally with `INKWELL_PROJECT=samples/hud-minimal`).
3. The Figma dot in the status bar shows the connection state and port; the SWF switcher lists the SWFs (orphaned ones under `Retained / Orphaned SWFs`) and the Navigator lists unreachable layers.
4. In Figma desktop: Plugins > Development > Import plugin from manifest > `Inkwell-Figma/plugin/manifest.json`. Run it: it connects by itself. The editor asks "A Figma plugin wants to connect: Allow?" (plugin version, file name, origin); click Allow. The dot reads `Waiting for approval` meanwhile and `Synced` after.
5. Put two top-level frames and one loose layer on the page. Edit a layer. Check the window's build timing (sync, codegen, swf, ffdec, total), `build/<frame name>.swf` for each frame, SWFs = 2, and the `unreachable-node` warning for the loose layer.

Check:

- Plugin badge goes compiling then synced after an edit; an unsupported or broken layer shows error with the issue.
- Version mismatch: connect a plugin built against another spec version; the plugin shows the "Protocol mismatch" / "Spec mismatch" message and does not retry.
- Deny: the plugin shows Denied and stays refused until the editor restarts. Ignore the prompt for 60 s: the plugin shows a timeout. Close the app: the plugin shows disconnected.
- Reconnect after restarting the app: the plugin reconnects by itself and is not asked again (its secret is known). Settings > Forget all Figma plugins makes it ask again.
- Screenshots of the prompt, the waiting dot and the Settings action without Figma: `INKWELL_SHOTS_FIGMA=1 INKWELL_SHOTS_DIR=<dir> INKWELL_SHOTS_PROJECT=<scratch copy of samples/hud-minimal>` with a separate `--user-data-dir` (`src/main/screenshotFigma.ts`, a fake plugin; `q1`..`q5`, `q2n-narrow` (960 px, long build line: the dots must stay visible), `q2s-select-in-figma` (Select / Focus in Figma reach the fake plugin as `selectNode`); it prints OK/FAILED per check and writes only that user-data dir's `settings.json`).
- Resend after restart: with `INKWELL_PROJECT` set, restart, reconnect, and the plugin's hash tree only resends nodes that differ from the saved IR; without a project, everything is resent.
- Delete a top-level frame: the window shows it as orphaned; its `swfs/<name>/` folder stays on disk.
- Selecting a layer in Figma updates the selection held by the server; main forwards it to the windows and the Navigator/Inspector mirror it (setting in the Figma dot popover, see `docs/ui-shell.md`).
