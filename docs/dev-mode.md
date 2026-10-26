# Dev mode: the game connection, hot reload and live inspection (milestone 0.3, Phase 6b)

SPEC-CHANGES S6 is the source of truth for the protocol (`RUNTIME_PROTOCOL = 1`, `inkwell-spec` `runtimeProtocol.ts`); the runtime side is `Inkwell-Runtime/docs/test-notes.md` section 12. **Nothing here has run against the real game**: the client is tested against a mock server (below), the AS2 hooks against FFDec and the compiler, the UI in the real Electron window. What the game does with it is the owner's test (end of this file).

## Pieces

| Piece | File | Notes |
|---|---|---|
| Client | `src/main/runtime/client.ts` | Electron MAIN process, the `ws` package (already a dependency for the Figma server; a `ws` client sends no `Origin` header and `Host: 127.0.0.1:<port>`, which the runtime requires; a renderer WebSocket always sends an Origin and is refused). Reconnect with backoff, idle watchdog, batching, reload requests |
| Pure protocol | `src/main/runtime/protocol.ts` | `reduce(core, message)` -> new state, messages to send, events for the UI, finished reload. No socket, no timers; unknown types and malformed JSON are ignored |
| Token and INI | `src/main/runtime/devIni.ts`, `token.ts` | generate, normalize a pasted token, merge `[Dev]` into `Inkwell.ini` (Spec `parseIni`/`writeIni`), token source order |
| Mock runtime | `src/main/runtime/mockRuntime.testutil.ts` | engine-free server on `node:net` with a hand-written RFC 6455 server side. Used by the unit tests and by the screenshot driver |
| Shared types | `src/shared/devLink.ts` | `DevState` (never contains the token, only `tokenMasked`), `DevEvent`, `maskToken`, `formatDevValue`, `reloadSummary` |
| Session | `src/main/session.ts` | owns the client, the per-project settings, the dev SWF builds and the hot reload after a deploy |
| UI | `shell/GameDot.tsx`, `panels/TracePanel.tsx`, `state/devStore.ts`, Deploy menu toggle | below |

## Connection states (Game dot, UX 4.6 Zone 6B)

| Phase | Dot | Meaning and what the client does |
|---|---|---|
| `off` | grey | no project, or you pressed Disconnect (no automatic connecting until Connect or a new token) |
| `noToken` | grey | no token known yet: "Paste the token from Inkwell.ini or run a Dev deploy" (UX 5.4). Re-reads the token sources every 15 s |
| `waiting` | grey | nothing listens on the port (game off, or dev mode off). Retries quietly with backoff 1 s up to 10 s; **no amber flicker** while the game is simply not running |
| `connecting` | amber | TCP is up, `hello` sent (5 s handshake window) |
| `connected` | green | `helloAck ok`. Amber when the runtime's `specVersion` differs from the editor's (still connected, message in the popover) |
| `unauthorized` | red | wrong token. **Not retried** (five bad tokens lock the server for 60 s). A new token (paste, Dev deploy) or Connect tries again |
| `protocolMismatch` | red | `protocolVersion` differs: "update the editor or the runtime". Not retried |
| `refused` | red | HTTP 403 on the upgrade (Origin or Host rejected); should not happen with this client |
| `busy` | amber | another editor holds the connection (`error busy` or `helloAck error busy`); retried every 15 s |

If the game closes the connection the state goes back to `waiting`, the last session stays visible in the Trace & Watch panel (greyed) and the client reconnects with a short backoff. **Subscriptions do not survive a reconnect**: after every `helloAck` the client sends `subscribe {menu, watch:true, pins:true}` for every menu the runtime lists, and for a menu that shows up later (`menuState` or a hot reload). After a `reloadAck` it subscribes the reloaded menus again, which makes the runtime send a fresh variable dump (S6).

Every runtime `ping {id}` is answered with `pong {id}`. No message at all for 35 s drops the socket (the runtime pings every 10 s). Incoming messages over 1 MiB close the socket (the `ws` size limit). `trace`, `watch` and `pin` are batched every 50 ms in main; inside a batch a repeated pin or variable is delivered once with its **latest** value (lossy, like the runtime's own coalescing).

## The token (O5)

Per project, in the editor's user settings (`<userData>/settings.json`, key `devLinks`, **never in the project or git**). The connection uses, in order:

1. a token you pasted in the Game popover (for the MO2 case where the runtime wrote or kept another `Inkwell.ini`),
2. `SKSE/Plugins/Inkwell/Inkwell.ini` in the MO2 **overwrite** folder (MO2's virtual file system gives it priority over a mod folder; it is also where the runtime writes a token it made itself),
3. the same file in the deploy target (the MO2 mod folder of the project),
4. the token the editor generated for the project's Dev deploys.

The first INI that has a `[Dev] Token` also gives the port when it has `[Dev] Port`; else the stored port (Game popover), else 8788. The popover shows the source and the **masked** token (`ab12...ef90`); the token is never logged, never sent to the renderer, never in a toast, a dialog, the deploy file list or the status bar. The paste field is a password input.

## Dev deploy

Deploy menu > **Dev deploy** checkbox (only shown for a project with a custom menu; **off by default**; per project, stored in user settings, not in the project). On:

- the first time it makes the project's token (256 random bits, 64 lower-case hex digits) and keeps it;
- the build pipeline also builds `build/<swf>.dev.swf` for every custom menu (stage `Dev SWF` in the timings): the normal game build with the dev hooks below. A Dev deploy builds it itself if it is not current;
- a deploy to **MO2 mod folder** or **MO2 overwrite folder** ships the dev SWF instead of the normal one and writes `SKSE/Plugins/Inkwell/Inkwell.ini` with `[Dev] DevMode=1`, `Token=<token>`, `Port=<port>`. An existing `Inkwell.ini` is parsed with the Spec parser and merged (`LogLevel`, `Watch`, `[Menu.*]` are kept; comments and unknown keys are not: the file belongs to the editor and the runtime), the old token is replaced. The file is written whenever it differs, is **not in the deploy manifest** (a later deploy without Dev deploy never removes or changes it; to switch dev mode off set `DevMode=0` or delete the file) and the confirmation dialog lists it as "dev mode and token, merged into the existing file" with a note that this is for testing;
- **Package Mod and the Vortex zip never contain any of it**: no dev SWF, no `Inkwell.ini`, no token, whatever the toggle says (tests in `deploy/devDeploy.test.ts` read the zip bytes). A HUD widget project gets no `Inkwell.ini`.

### Hot reload on Deploy

After a successful Dev deploy the session sends `reload {id, menu}` for each deployed menu (menu JSON `name`) and waits for the `reloadAck`. The result is shown in the status bar deploy item (`hot reload: reloaded <menu> in 118 ms`), in the toast and in `DeployResult.hotReload`; when the game is not connected it says so. The runtime's own file watcher (`Watch=1`) may reload the same menu once more; the second one reports it unchanged. **Trigger Hot Reload** in the Trace & Watch panel and the Game popover sends the same request for the active SWF's menu (or every menu from the popover). **The engine caches a loaded movie by name** (seen in game: the same movieDef came back), and it only finds loose files that existed when the game started. So a Dev deploy also ships 16 copies of the dev SWF per menu (`Interface/Inkwell/_dev/<menu>_0..15.swf`, `devReloadPaths`); each hot reload makes the runtime overwrite the next unused copy and load it (16 reloads per game session, then restart). **Hot Reload** (button in the Trace & Watch panel and in the Game popover, `state/hotReload.ts`): with Dev deploy on and a custom menu active it deploys the active SWF to the MO2 mod folder (first deploy to a folder: the usual confirmation) and the deploy reloads the game; a menu that has no finished build is built first, as for every deploy (`ensureBuilds`). With Dev deploy off it only asks the game to re-read what is on disk (for files changed outside the editor). **Automatic**: with Dev deploy on and the game connected, a graph edit starts a Hot Reload after 3 s without further edits, or at once when the graph editor loses focus (also when you switch to the game window); it never opens the confirmation dialog or a success toast (the status bar shows the result).

## Dev hooks in the game SWF (S6, S7)

`dev: true` in `generate()` / `CodegenInput` (only with the menu flavour; never for the preview, a HUD widget or the normal build):

- every pure node's first output goes through `__g.pv(node, pin, value)`, which calls `this.bridge.pin(node, pin, value)` (guarded by try/catch) and returns the value: the Ruffle preview's mechanism (`docs/debugging.md`) with the bridge instead of `trace`;
- after every assignment of a variable (nodes with `extra.writesVariable`: Set Variable, Toggle), after `setSaved` and before the bindings: `__g.bridge.watch("<graph id>", "<name>", "<scope>", __g.v_<name>);`;
- each graph class gets `dumpVariables()` (one `bridge.watch` per variable) and the menu class's `dumpVariables()` calls every graph's, each guarded. The runtime calls it when the editor subscribes with `watch:true` and when the menu opens. In the normal build `dumpVariables` stays the empty method;
- `inkwell.log` calls (Log, Assert, `fail`) are always emitted, dev or not (S6). With the stub bridge of a missing runtime the new calls are no-ops (the stub has every member of the Spec table).

Golden AS2 for both flavours and an FFDec compile of the dev SWF: `src/main/codegen/codegen.dev.test.ts`.

## UI

- **Game dot** (status bar): see the table. The popover (opens upward) shows the status, the message, runtime version, Skyrim version, protocol and spec, port, token source with the masked token, the menus the runtime knows with open/closed, Connect / Disconnect, Trigger Hot Reload, the paste-token field and the port field. *(The status bar no longer clips its popovers: `overflow: hidden` was removed from `.statusbar`; before, the Figma dot's popover was cut off too.)*
- **Runtime Trace & Watch**: `Ruffle preview | Game (Dev Mode)` switch (default Ruffle, not switched automatically). Game source: lines `[time] LEVEL as2|runtime <menu> <node title> #<node id> text`; a line with a node id of the active SWF's graphs selects the node and opens its graph (the 0.2 `openGraphNode`, same node-id lookup); "Warnings and errors only"; `Clear Trace` (lines, watch table and pins of the game); the **LIVE VARIABLE WATCH** table (Component, Menu, Saved, then by name; values update live); a chip with the connection; `Trigger Hot Reload` with its result line. Never connected: the empty state **Start Skyrim with Dev Mode enabled** (UX 5.4). Disconnected after a session: the last session stays, greyed, with a note.
- **Pin badges** on the canvas: from the source the panel is on. Ruffle: the 0.2 badge (`data-source="preview"`); Game: a green badge with the game's latest value (`data-source="game"`, tooltip "Last value in the game"). A new session (`session` counter) clears the game's pins and watch values, not the trace lines. Strings are quoted; Array/Object arrive from the runtime as a JSON string cut at 512 characters and are shown as is (a string that starts with `[` or `{` is treated that way: a real string value that looks like JSON is shown unquoted).

## Tests

- `runtime/client.test.ts` (24): against the mock runtime: no Origin and the right Host, hello fields, subscribe, wrong token (red, **not retried**, recovers on a new token), protocol mismatch, spec difference, busy and slow retry, game not running (no amber), no token, masking (the token is not in any state or event), Disconnect/Connect, ping/pong with ids, reconnect and resubscribe, idle watchdog, `menuState`, trace fields, lossy pins and watch, malformed or unknown messages, reserved opcode and oversize frame (reconnect), runtime `error`, reload ack / all menus / unknown menu / not connected / no answer / lost connection.
- `runtime/protocol.test.ts`: the pure reducer, token masking and normalizing, the INI writer (fresh, merge, damaged file), token source order.
- `deploy/devDeploy.test.ts`: the dev INI and dev SWF only with the toggle on, merge, second deploy unchanged, a later normal deploy leaves the INI, **Package Mod and Vortex zips contain neither**, no token in the prepared result, HUD widgets get no INI.
- `renderer/state/devStore.test.ts`: dot tones and labels per phase, the popover (versions, menus, masked token only), the store (session reset, lossy values, order, caps) and the panel rendered to markup (Ruffle default, empty state, game lines, watch table, greyed).
- Driver `INKWELL_SHOTS_DEV=1` (`src/main/screenshotDev.ts`): the real Electron window against the mock runtime, 34 checks and states `d1` to `d14`. Run: `yarn build`, then with `ELECTRON_RUN_AS_NODE` unset `INKWELL_SHOTS_DEV=1 INKWELL_SHOTS_DIR=<dir> INKWELL_SHOTS_PROJECT=<scratch copy of samples/menu-nodes> INKWELL_MO2_MODS=<scratch folder> electron . --user-data-dir=<scratch>` (the last part does a real Dev deploy and checks the files). It edits the project it is given.

## Test with the real game (owner)

No console command is needed. The owner's consolidated test is `TEST-IN-GAME-0.3.md` (workspace root), test T5; this section is the detail.

**Prepared folder.** `yarn deploy:menu-nodes --dev --to "C:\Modding\MO2\mods\Inkwell Menu Dev Test"` (already run) built the nodes sample as a Dev deploy: the dev SWF, `SKSE/Plugins/Inkwell/Inkwell.ini` with `DevMode=1`, `Port=8788` and a `Token`, and the runtime DLL. It also stored the SAME token in `%APPDATA%\inkwell-editor\settings.json` under `devLinks["d:\mods\inkwell\inkwell-editor\samples\menu-nodes"]` (key = the lower-case folder of the project), so the editor finds it without the file: token source "editor". **How to connect:** (1) in MO2 enable `Inkwell Menu Dev Test` only (disable the other Inkwell test mods); (2) start the editor, open the project `D:\Mods\Inkwell\Inkwell-Editor\samples\menu-nodes` (the Open Project command); the Game dot is grey ("waiting") until the game runs; (3) start Skyrim; the dot turns green. If you want to Deploy from the editor into the same folder, set Settings > Mod name to `Inkwell Menu Dev Test` (the sample's own target is `Inkwell Menu Nodes Test`) and tick **Dev deploy** first. If the dot stays red or grey: the Game popover shows the token source; a different `Inkwell.ini` in MO2's `overwrite` folder wins over the one in the mod folder, so paste its `Token=` value into the popover.

1. (Skip this step when you use the prepared folder above.) In the editor open `samples/menu-nodes` (or your project), Settings: set the MO2 mods directory so the deploy target is `...\mods\<project name>`. Open the **Deploy** menu, tick **Dev deploy**, then Deploy > MO2 mod folder, confirm. Check the dialog lists `SKSE/Plugins/Inkwell/Inkwell.ini (dev mode and token...)`. The status bar shows "hot reload skipped: the game is not connected" (expected: the game is off).
2. Make sure the runtime `Inkwell.dll` is in the same or another enabled mod. Check there is **no other** `Inkwell.ini` in MO2's `overwrite` folder (if there is one, see step 6).
3. Start Skyrim (MO2). In `Inkwell.log`: the `INKWELL DEV MODE IS ON` block and `dev server on 127.0.0.1:8788, token <first4>...<last4>` (the same four digits as the editor's popover shows).
4. In the editor the **Game dot turns green** within about 15 s (hover: runtime version). Popover: runtime 0.3.0, Skyrim version, your menus. Open the menu in game (F9 for menu-nodes): the popover shows it open.
5. Trace & Watch > source **Game (Dev Mode)**: click the menu's buttons: lines appear with node ids (Log nodes), click a line: the node is selected. The watch table fills (`clicks`, Saved) and **green badges** appear on pure nodes' output pins. Close and reopen the menu: values refresh. Deliberate error: a Throw node shows `ERROR ... #<node>` and the menu keeps working.
6. **Hot reload**: change something visible (a text in Figma or a Set Text value), Deploy again with Dev deploy on. With the menu open it closes and reopens by itself; the status bar says `hot reload: reloaded <menu> in N ms`. If the old content shows, the movie cache is the problem (S6 fallback). Also try Trigger Hot Reload.
7. Wrong token: put another 64-digit token into the popover field: red dot "Refused: wrong token", no retries. If MO2 shows an `Inkwell.ini` in `overwrite` that you did not make: paste its `Token=` value into the popover, the dot turns green.
8. Close the game: the dot turns grey, the panel greys the last session. Start it again: it reconnects by itself.
9. Report: what differs, plus every `[dev]` or `hot reload` line of `Inkwell.log` that looks wrong.

## Limits and decisions

- The editor subscribes to **every** menu the runtime lists (watch and pins), not only the project's; the runtime throttles (20 pins/s per pin, 200 messages/s).
- `Inkwell.ini` merge drops comments and unknown keys (Spec writer).
- No token = grey, not red: UX 5.4 says red for a missing token, but without a game or any dev deploy that would show a red dot to everyone who never uses dev mode; red is for what the game actually refused.
- The game's pin and watch values are not shown in the Ruffle source and vice versa; the switch is manual.
- Menu name for Trigger Hot Reload is derived like the deploy does (`resolveMenuNames`); a menu the game does not list gets the runtime's `unknown-menu` error text.
- Not verified: everything on the real runtime side (movie cache, `bridge.watch`/`pin` from a real SWF with many native members, timing of `dumpVariables`, whether `subscribe` after `reloadAck` triggers a dump).
