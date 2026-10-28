// The Ruffle preview's stand-in for the game engine (Phase 5): what a menu replacement shows in the editor, since there is no engine to fill it.
// Preview only (`replacementGlue(..., preview = true)`); never in the deployed SWF. Per contract menu, AS2 method lines of the glue class: `mock()` makes the
// engine callbacks after the graphs started, `mockAnswer(name, id)` answers the engine requests that the glue traces instead of sending.

const INVENTORY = [
  '    // preview stand-in for the engine (Ruffle): categories, an item list and the item card',
  '    function mock() {',
  '        this.fire("SetCategoriesList", ["All", 1, true, "Favorites", 1, false, "Weapons", 1, false, "Apparel", 1, false, "Potions", 1, false, "Misc", 1, false]);',
  '        this.list.entryList = [',
  '            {text: "Iron Sword", count: 1, enabled: true, equipState: 1, filterFlag: 2, favorite: 0, info: {name: "Iron Sword", type: "One-handed sword", value: 25, weight: 9, damage: 7}},',
  '            {text: "Steel Armor", count: 1, enabled: true, equipState: 0, filterFlag: 4, favorite: 0, info: {name: "Steel Armor", type: "Heavy armor", value: 275, weight: 35, armor: 31}},',
  '            {text: "Potion of Healing", count: 3, enabled: true, equipState: 0, filterFlag: 8, favorite: 1, info: {name: "Potion of Healing", type: "Potion", value: 50, weight: 0.5}},',
  '            {text: "Lockpick", count: 12, enabled: true, equipState: 0, filterFlag: 16, favorite: 0, info: {name: "Lockpick", type: "Misc", value: 3, weight: 0}},',
  '            {text: "Iron Ingot", count: 5, enabled: true, equipState: 0, filterFlag: 16, favorite: 0, info: {name: "Iron Ingot", type: "Ingot", value: 7, weight: 1}}',
  '        ];',
  '        this.list.selectedIndex = 0;',
  '        this.fire("UpdatePlayerInfo", [{health: 100, maxHealth: 100, magicka: 50, maxMagicka: 50, stamina: 80, maxStamina: 80, encumbrance: 40, maxEncumbrance: 300, armor: 31, damage: 7, gold: 120}]);',
  '        this.fire("InvalidateListData", []);',
  '    }',
  '    function mockAnswer(name, id) {',
  '        if (name == "RequestItemCardInfo") this.answer(id, [this.list.entryList[this.list.selectedIndex].info]);',
  '    }'
]

/** AS2 class-body lines of the preview mock for a contract menu, or undefined when there is none (the glue then only traces). */
export const previewMock = (menu: string): string[] | undefined => (menu === 'InventoryMenu' ? INVENTORY : undefined)
