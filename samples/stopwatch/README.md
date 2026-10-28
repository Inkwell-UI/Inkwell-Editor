# Skyrim Stopwatch

A custom menu: a card with a running time (`$TIME`) and Start, Stop and Reset buttons. It is the example of a Figma-designed menu with a **graph** (`swfs/menu_Stopwatch/graphs/menu-stopwatch.json`: On Load, On Click, On Timer, Divide, Modulo, Format Number) and the exit-menu concept of milestone 0.4.

- **Needs:** the Inkwell Runtime (`Inkwell.dll`, SKSE). The menu opens with hotkey **H** (`menu.json`, key code 35) or the mod event `SkyrimStopwatch_Open`.
- **Open it in the editor:** copy the folder somewhere you may edit (the repo copy stays as it is), then File > Open Project. (The start screen's example button copies only HUD Minimal today.)
- **No binaries:** the card background that was a PNG in the Figma file is a plain vector card here (a solid fill and a gold stroke), so the example is text only. Linear and radial gradients are not compiled in 0.5 (the first colour is used, lint `fill-gradient-approximated`), so a gradient would not look like one. A Figma sync replaces it with your own design.
- **Deploy:** Deploy > your MO2 mod folder. Set the folder in Settings first.
- Not run in game as an example (the original project was, 2026-10-27); this copy is checked by `src/main/project/examples.test.ts` (loads, compiles).
