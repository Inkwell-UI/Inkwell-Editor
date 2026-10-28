# Contracts: replacing a game menu (0.5)

A **menu replacement** is an SWF that the game loads *instead of* one of its own menus (for example `Interface\inventorymenu.swf`). The game talks to that SWF by name: it looks up functions, clips and variables and calls them. If something it needs is missing, the game crashes or the menu half works. A **contract** is the list of what the game (and SkyUI) look for, so Inkwell can check your menu **before** you deploy and generate the glue that answers the game.

0.5 ships one contract: **`InventoryMenu`**. It was measured on Skyrim SE 1.7.104 (with no SkyUI, SkyUI 5.2 and SkyUI 6.11). **AE was not tested separately** (expected to work through the same engine calls; nobody has confirmed it). GOG is unverified.

## Making a replacement

1. Draw a top-level frame (1920 x 1080 or the stage you want). Inside it a frame named exactly **`Menu_mc`**: the game looks this clip up and **crashes without it**.
2. Top bar > **Target** pill > **Target of this SWF**: **Menu replacement (replaces a game menu SWF)**. Set **Contract (game menu it replaces)** to `InventoryMenu`.
3. **Built for** (layers, below): *The game* is always on. Tick **SkyUI 5.2 players** if you want players with SkyUI 5.2 to see no error. SkyUI 6 needs nothing.
4. In **Behaviour** mode use the **Inventory** nodes (On Set Categories, On Invalidate List, On Item Card, On Key, On Drop Item, On Attempt Equip, Item Select, Item Drop, Save Indices, Close Menu, Play Sound, Request Item Card, Update Item 3D). They only work in a replacement of this contract (otherwise lint `contract-node-target`).
5. **Build All** and **Deploy**: the SWF goes to `Interface\inventorymenu.swf` in your mod folder (a loose file that wins over the game's archive copy). Untick other mods that replace the same menu.

The worked example is `samples/inventory-replacement` (its README says what each part does). Its layout is plain text on purpose.

## Layers: "Built for"

A contract has **layers**; you choose which ones your menu is built for:

| Layer | What it adds | When you need it |
|---|---|---|
| `engine` | What the game executable needs. Always checked. | always |
| `skyui52` | Four `_global` classes (`InventoryMenu`, `ItemCard`, `BottomBar`, `InventoryLists`) with `SKYUI_RELEASE_IDX = 2018` and `SKYUI_VERSION_STRING = "5.2 SE"`. | SkyUI **5.2** checks these when the inventory opens and shows **"SKYUI ERROR CODE 5"** when they are missing. Inkwell defines them for you when the layer is ticked (tested: no popup). |
| `skyui6` | Nothing. | SkyUI 6.11 checks nothing in a replaced inventory (tested: no popup). The layer exists so the choice is explicit. |

Ticking `skyui52` does no harm for players who have SkyUI 6 or no SkyUI (both tested).

## How strict each entry is

Every entry of a contract has a level. The contract file (`Inkwell-Spec/contracts/<Menu>/<layer>.json`, copied to `resources/contracts`) says why, and what evidence it rests on (`in-game` = a spike run, `source` = read from the decompiled game and SkyUI files, `inferred`):

| Level | Meaning | Example (Inventory) |
|---|---|---|
| `fatal` | The game **crashes** when the menu opens without it. | `_root.GetInventoryItemList` (a function) and the clip `_root.Menu_mc` |
| `function` | The menu opens, but a feature is dead without it. | the engine callback bridge `_root.call` / `_root.respond`; the item list's `entryList` and `selectedIndex` (equip, drop and the item card need them) |
| `optional` | Used when present. | `InitExtensions`, `SetPlatform`, the item card callback and request, the engine callbacks and calls the nodes use |
| `unused` | The game looks it up and does without it. | `_root.BackgroundAlpha` |

Inkwell's generated **engine glue** (a class installed at `_root.inkwellContract` before your graphs start) already provides the functions, the list object, the bridge and the SkyUI statics. **You** provide what only the drawing can: the `Menu_mc` clip.

## Reading a contract lint error

The Lint dock shows these as **errors** (they block Deploy; only a replacement's own `contract-*` errors block it):

| Code | Plain meaning | Fix |
|---|---|---|
| `contract-missing` | A path the contract requires is not in your menu. The message names the path, who needs it ("the game", "SkyUI 5.2") and what happens without it ("the game crashes when the menu opens"). | Add the layer with that name (for `_root.Menu_mc`: a frame named `Menu_mc` directly in the stage frame), or tick the layer. |
| `contract-wrong-type` | The name exists but is the wrong kind (a `Menu_mc` that is text, say). | Make it the type the message says (a frame is a MovieClip). |
| `contract-unknown` | The contract you named does not exist. | Pick one in the Target dialog (`InventoryMenu`). |
| `contract-layers` | The **Built for** list is not valid (the game layer first, known layers only). | Reopen the Target dialog and re-tick. |
| `contract-none` (warning) | The replacement names no contract, so nothing is checked. | Choose a contract. |

Example: `_root.Menu_mc (instance, MovieClip) is required by the game ("InventoryMenu" contract); without it the game crashes when the menu opens.` means: add a frame named `Menu_mc` to the stage.

## What a contract cannot promise

- It checks **names and types**, not behaviour. Whether your graph answers the engine correctly (equip, drop, the card) is what the in-game test shows.
- The replacement has **no Inkwell Runtime** (no hotkey, no INI, no saved variables): the game opens it from its normal key.
- Gamepad: the engine's own pad navigation reaches a replacement (tested on all three SkyUI states); keyboard keys are graph events (On Key).
- Logging: a replacement writes no log of its own; use the screenshot and `skse64.log` / crash logs when testing.
- Do not ship or copy the game's or SkyUI's files: the editor refuses to export an unmodified game SWF and the contract data holds names and signatures only.
