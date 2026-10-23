# Figma sync server (`src/main/sync`)

A `ws` server in the Electron main process, started on app ready and closed on quit. Protocol and IR types come from `@inkwell-ui/spec` (`PluginMessage`, `ackHello`, `applyPatch`, `hashNode`).

- Binds `127.0.0.1` only, first free port of 8787-8790 (the plugin tries the same range).
- Random 48-hex session token per start, passed as `?token=`; constant-time compare. 401 for a bad token, 403 for any `Origin` other than `null` (Figma plugin iframes) or absent.
- Invalid JSON, unknown or invalid messages get an `error` message; the socket stays open. A `PatchError` becomes `error {code, message, nodeId}` and the store is unchanged.
- `hello` -> `helloAck` (`ackHello`); a protocol or spec mismatch sends the error and closes.
- The store is the visual IR of one swf (the protocol carries no swf id): the first swf of the project at `INKWELL_PROJECT`, else `main`, starting empty. The first parentless node of a fresh store becomes `root`.
- `hashTree`: nodes missing or with a different `hashNode` get a `resend {ids}`. Nodes the plugin no longer has are kept, not deleted.
- After a patch, a 100 ms debounce, then `onChange(swfId, ir)`; the plugin gets `status` `compiling`, then `synced` (or `error` when a lint issue has severity `error` or the hook throws).
- `buildPipeline.ts` is the default `onChange`: stages `sync` (save IR), `codegen`, `swf`, `ffdec` via `compileSwf` and the resident wrapper; lint issues go out as `status.issues` (with `severity`). Output: `<project>/build/<swf>.swf` (git-ignored), or `<userData>/build` without a project.

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
3. The window shows the connection state, port, session token and lint count; click Copy.
4. In Figma desktop: Plugins > Development > Import plugin from manifest > `Inkwell-Figma/plugin/manifest.json`. Run it, paste the token, connect.
5. Edit a layer. Check the window's build timing (sync, codegen, swf, ffdec, total) and `build/<swf>.swf` appearing.

Check:

- Plugin badge goes compiling then synced after an edit; an unsupported or broken layer shows error with the issue.
- Version mismatch: connect a plugin built against another spec version; the plugin shows the "Protocol mismatch" / "Spec mismatch" message and does not retry.
- Wrong token: connection refused. Close the app: the plugin shows disconnected.
- Reconnect after restarting the app: the plugin reconnects by itself (the token changes, so paste the new one).
- Resend after restart: with `INKWELL_PROJECT` set, restart, reconnect, and the plugin's hash tree only resends nodes that differ from the saved IR; without a project, everything is resent.
- Selecting a layer in Figma updates the selection held by the server (no UI yet).
