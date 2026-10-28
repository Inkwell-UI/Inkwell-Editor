# Getting started: from an empty Figma file to a menu in Skyrim

For a modder who has never used Inkwell. Every step says where to click. Where Inkwell cannot check something for you (the game side), the step says so. If a step needs something this page does not tell you, that is a gap in this page: write it down and tell the author.

**What Inkwell is.** You draw a menu in Figma. The Inkwell plugin sends it to the Inkwell editor (a desktop app), which turns it into a Flash (SWF) menu that Skyrim can show, and puts it in a mod folder. Behaviour (what a button does) is a visual graph in the editor, not code. A menu opens in game through the **Inkwell Runtime**, a small SKSE plugin.

**What was tested.** Skyrim Special Edition (1.7.104 on the author's install) with SKSE64 and Mod Organizer 2 (MO2). Anniversary Edition and GOG were **not tested separately**: they are expected to work, nobody has confirmed it. For Vortex, Inkwell saves a zip, not a folder.

## 1. What you need

| Need | For | Where |
|---|---|---|
| Skyrim Special Edition, SKSE64, Address Library for SKSE Plugins | the game side | your usual mod sources |
| Mod Organizer 2 | where Inkwell puts your mod | Settings asks for its `mods` folder |
| Figma **desktop** app (a free account is enough) | drawing; the plugin runs in the desktop app | figma.com |
| The Inkwell editor | the app (portable zip, no installer) | the beta download |
| The Inkwell Figma plugin | sends your design to the editor | in the beta download (`Inkwell-Figma/plugin`) |
| `Inkwell.dll` (Inkwell Runtime) | opens your menu in game | the beta download; **not** included in the mod Inkwell builds |
| Java 8 or newer and **FFDec** (JPEXS Free Flash Decompiler), the version the Doctor names | Inkwell drives FFDec to make the SWF | install them yourself; Inkwell never bundles them |
| A Papyrus compiler (russo's `papyrus.exe`) | optional: the "runtime missing" message and HUD widget scripts | install it yourself |

You do **not** need SkyUI for a custom menu. A HUD widget needs SkyUI.

## 2. First start and the Setup Doctor

1. Unzip the editor into any folder you may write to and start it.
2. The first time something is missing, the **Settings** view opens by itself (otherwise: **Edit > Settings**, Ctrl+,). It lists rows (Java, FFDec, FFDec wrapper, Papyrus compiler, Skyrim install, Vanilla SWF cache, Project .gitignore, Figma plugin, MO2 deploy folders) with a status each and a button to fix it (for example **Get Java**, **Get FFDec**, **Browse for the FFDec folder**). Read each row: it says plainly what is missing and what to do.
3. Fix at least **Java**, **FFDec**, **FFDec wrapper** (a small jar that ships in the beta zip; if the row says it is missing, the zip is incomplete), **Skyrim install** (it finds Steam and GOG installs; **Browse** if yours is elsewhere) and **MO2 deploy folders** (the **MO2 mods directory**, for example `C:\Modding\MO2\mods`, and the **Mod name**, the folder Inkwell writes inside it). Each field has **Browse**; the badge beside it says where the value came from.
4. In the **Vanilla SWF cache** row use **Build the cache** once. It extracts the game's own SWFs from your install into the editor's data folder, only so Inkwell can refuse to export an unmodified game file. Nothing of it goes into your project.
5. Click **Re-run**. Rows you do not need yet (Papyrus, Figma) may stay yellow.

## 3. Fonts for Figma (once, optional but recommended)

Settings > **Fonts for Figma** > **Install Skyrim fonts**. This installs the game's fonts for your Windows user so Figma can use them (`Everywhere`, `SkyrimBooks`, ...). Quit Figma completely (also from the tray) and start it again. Without it any font name works but gets a `font-fallback` warning. More: `docs/starter-kit.md` and `docs/font-install.md`.

## 4. Connect Figma

1. In the Figma desktop app open any design file, then **Plugins > Development > Import plugin from manifest...** and pick the plugin's `manifest.json` (from the beta download, `Inkwell-Figma/plugin/manifest.json`). Do this once.
2. In the editor: **New Project** (start screen), choose an **empty folder**, named after your mod. The folder name becomes the mod id (letters and digits only).
3. In Figma run **Plugins > Development > Inkwell**. The editor asks **"A Figma plugin wants to connect: Allow?"** Click **Allow** (only once per computer; **Deny**, or no answer within 60 seconds, keeps it out). The dot at the bottom right of the editor reads `Synced` when it works.

## 5. Draw a menu

1. In Figma make **one top-level frame** of **1920 x 1080** for the menu. One top-level frame becomes one SWF. Loose layers outside a frame are ignored with a warning (`unreachable-node`).
2. Inside it draw a panel (a rectangle), a title (text) and a button: a frame named `btn` holding a rectangle and a text. Use plain frames, rectangles and text; components and instances are not compiled yet. Use text styles named `Family / Style / Size`, for example `Everywhere / Medium / 24`.
3. Every layer name becomes a name the graph can use. Hidden layers are not compiled.
4. The plugin sends every change at once. In the editor the **Preview** shows your menu and the **Lint** dock at the bottom lists problems (errors block a deploy).

## 6. Make it a menu and give it behaviour

1. Top bar: click the **Target** pill (it reads `hudWidget` for a new frame). In the dialog set **Target of this SWF** to **Custom menu (Inkwell Runtime opens it)**.
2. On the left open the **Menu** tab. Set the open trigger: **Default Open Key**, and tick **Papyrus API** or a **mod event** if other mods should open it. Leave the flags (pauses the game, shows the cursor, Esc closes) as they are for a first menu.
3. Select the button frame in the Navigator. In the **Inspector** set **Role** to **button** and check **Instance Name** (`btn`).
4. Switch to **Behaviour** mode (top bar, or Ctrl+2). Add **On Click** (press Space on the graph canvas to search), pick the button as its target, then add **Set Text**, wire the `then` pin of On Click to the `in` pin of Set Text, pick the title as its target and type the text. Details: `docs/graphs.md`.
5. Check the **Preview** (Play tab: click the button; the text changes). **Lint** must show no error.

## 7. Deploy to MO2

1. Top bar: **Build All**, then the **Deploy** dropdown > **MO2 mod folder**. The first deploy to a new folder asks you to confirm: **Deploy**.
2. Inkwell writes your mod into `<MO2 mods>\<mod name>\`: the SWF, a menu JSON and a default INI under `SKSE\Plugins\Inkwell\` and, with a Papyrus compiler, a small plugin `<modId>_RuntimeCheck.esp`. It **never** writes into the game's own `Data` folder.
3. **Install the runtime once:** put `Inkwell.dll` at `SKSE\Plugins\Inkwell.dll` inside an MO2 mod (for example your mod's own folder). Inkwell does not do this for you.
4. In MO2 refresh (F5) and **tick** your mod (and the runtime mod). If you have a runtime-check plugin, keep it enabled.

## 8. Test in game

1. Start Skyrim through SKSE in MO2 and load a save. Press your **open key**. Your menu appears.
2. Click the button: the text changes. **Esc** closes the menu (if you left that flag on).
3. If nothing appears, see below.

## When something goes wrong

| Symptom | Look here |
|---|---|
| The menu does not open; a message about the Inkwell Runtime | `Inkwell.dll` is missing or too old (the runtime-check message). Copy the runtime again and check SKSE runs. |
| "could not load Interface/Inkwell/..." at the top left of the screen | The SWF was not found or the game refused it. Read `Documents\My Games\Skyrim Special Edition\SKSE\Inkwell.log` (the line starting `no movie`) and redeploy. |
| Deploy is blocked | The **Lint** dock lists errors; each row jumps to its layer. Strict Mode (project settings) turns warnings into errors. |
| The editor shows `FFDec: not found` | Settings, the FFDec row. |
| The plugin does not connect | Is the editor running? The plugin retries by itself. Settings > **Forget all Figma plugins** makes it ask again. |
| The game crashes | Send the newest `*crash*.log` (Crash Logger) and `Inkwell.log` to the author. |

Next: `docs/gamepad.md` (pad support), `docs/packs-guide.md` (more nodes), `docs/contracts.md` (replace a game menu) and the examples in `samples/` (each has a README).
