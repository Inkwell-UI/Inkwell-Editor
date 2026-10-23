# Figma sync server (`src/main/sync`)

A `ws` server in the Electron main process, started on app ready and closed on quit. Protocol and IR types come from `@inkwell-ui/spec` (`PluginMessage`, `ackHello`, `applyPatch`, `hashNode`).

- Binds `127.0.0.1` only, first free port of 8787-8790 (the plugin tries the same range).
- Random 48-hex session token per start, passed as `?token=`; constant-time compare. 401 for a bad token, 403 for any `Origin` other than `null` (Figma plugin iframes) or absent.
- Invalid JSON, unknown or invalid messages get an `error` message; the socket stays open. A `PatchError` becomes `error {code, message, nodeId}` and the store is unchanged.
- `hello` -> `helloAck` (`ackHello`); a protocol or spec mismatch sends the error and closes.
- **One SWF per top-level Figma frame.** The server keeps one store per swf, keyed by the frame's node id (`patch.swfId`, protocol 2). Swfs of `INKWELL_PROJECT` (`swfs/<name>/ir.json`) are loaded by their `ir.id`; a new swf starts empty with `root = swfId`. `patch.swf` metadata (`name`, `stage`, `target`) sets the stage size and the swf name: the sanitized frame name (`A-Za-z0-9._-`, other runs become `_`), made unique case-insensitively (`Menu`, `Menu_2`), and never renamed by case alone. Folder `swfs/<name>/`, output `<project>/build/<name>.swf`; a renamed frame moves its folder and overlay.
- `hashTree {swfId}`: nodes missing or with a different `hashNode` get a `resend {swfId, ids}`. Nodes the plugin no longer has are kept, not deleted.
- `swfs {frames, loose}` (plugin -> editor, on connect and when the page's top level changes): a known swf whose frame is missing is **orphaned** (kept, never built, never deleted; the window counts it, the plugin gets an `orphaned-swf` warning). A patch that removes a swf's root is treated the same and the last IR is kept. Loose top-level layers (anything but a FRAME directly on the page) belong to no swf: `unreachable-node` warning "this layer is not inside an exported frame", sent as a project-level `status` (no `swfId`). A node inside a swf that no root reaches gets the same warning in that swf's build status.
- Builds are debounced and run one swf at a time (one resident FFDec wrapper). `status` carries `swfId`; the plugin rolls them up (error beats compiling beats synced).
- After a patch, a 100 ms debounce, then `onChange(swfId, ir, name)` for each touched swf; the plugin gets `status` `compiling`, then `synced` (or `error` when a lint issue has severity `error` or the hook throws).
- `buildPipeline.ts` is the default `onChange`: stages `sync` (save IR), `codegen`, `swf`, `ffdec` via `compileSwf` and the resident wrapper; lint issues go out as `status.issues` (with `severity`). Output: `<project>/build/<name>.swf` (git-ignored), or `<userData>/build` without a project.
- The window lists, for the latest build of each swf (kept per swf id, so frames never overwrite each other): a **Fonts** table (swf, layer, Figma `family/style`, text style name, resolved Skyrim alias or `unmapped`, and how: `text style` | `family/style` | `fallback` | `unmapped`) and a **Lint** list (errors first; severity, code, message, swf, layer name). `compileSwf` returns the fonts as `fonts`; they are not lint issues and not in the lint count.

## Config

| Env | Default |
| --- | --- |
| `INKWELL_FFDEC` | `C:\Program Files (x86)\FFDec` |
| `INKWELL_JAVA` | `java` |
| `INKWELL_PROJECT` | unset: nothing is saved |

The wrapper jar comes from `yarn build:wrapper`. If FFDec or the jar is missing the server still starts and every build reports an `error` status with a clear message.

## Manual end-to-end test (Figma desktop)

1. In `Inkwell-Spec` run `yarn build`; in `Inkwell-Figma` run `yarn install --force` (re-copies the spec), then `yarn build`.
2. Here: `yarn build:wrapper` once, then `yarn dev` (optionally with `INKWELL_PROJECT=samples/hud-minimal`).
3. The window shows the connection state, port, session token, the number of SWFs (and orphaned ones) and the total lint issues (all swfs plus loose layers); click Copy.
4. In Figma desktop: Plugins > Development > Import plugin from manifest > `Inkwell-Figma/plugin/manifest.json`. Run it, paste the token, connect.
5. Put two top-level frames and one loose layer on the page. Edit a layer. Check the window's build timing (sync, codegen, swf, ffdec, total), `build/<frame name>.swf` for each frame, SWFs = 2, and the `unreachable-node` warning for the loose layer.

Check:

- Plugin badge goes compiling then synced after an edit; an unsupported or broken layer shows error with the issue.
- Version mismatch: connect a plugin built against another spec version; the plugin shows the "Protocol mismatch" / "Spec mismatch" message and does not retry.
- Wrong token: connection refused. Close the app: the plugin shows disconnected.
- Reconnect after restarting the app: the plugin reconnects by itself (the token changes, so paste the new one).
- Resend after restart: with `INKWELL_PROJECT` set, restart, reconnect, and the plugin's hash tree only resends nodes that differ from the saved IR; without a project, everything is resent.
- Delete a top-level frame: the window shows it as orphaned; its `swfs/<name>/` folder stays on disk.
- Selecting a layer in Figma updates the selection held by the server (no UI yet).
