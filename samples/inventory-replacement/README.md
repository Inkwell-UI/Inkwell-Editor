# Inventory replacement (proof)

Replaces the game's **inventory menu** (`Interface\inventorymenu.swf`) with a menu drawn in Figma: a categories line, the item list with a `>` mark, and the item card, driven by one graph on the **Inventory** nodes (On Invalidate List, On Item Card, On Key, Item Select, Item Drop, Save Indices, ...).

- **Target:** `menuReplacement`, contract `InventoryMenu`, built for the game and SkyUI 5.2 (works with SkyUI 5.2, SkyUI 6.11 and no SkyUI; tested on Skyrim SE 1.7.104, AE assumed). See `docs/starter-kit.md` (Inventory menu replacement) and the contracts guide.
- **The clip `Menu_mc` is required:** the game crashes without it. The editor's contract lint blocks the deploy if it is missing.
- **Editor preview:** the preview fills the menu with mock items (preview only, never deployed).
- **Deploy:** `yarn deploy:inventory` (to `C:\Modding\MO2\mods\Inkwell Inventory Replacement Test`) or Deploy in the editor. Untick other mods that replace the inventory.
- **Pad:** works through the game's own navigation; keys Up/Down/Enter/R/Tab/Esc are graph events.
- Plain text on a panel: replace it with your own design.
