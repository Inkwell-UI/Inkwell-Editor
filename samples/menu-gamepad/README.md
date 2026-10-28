# Gamepad menu

A custom menu with four buttons, a **focus graph** (overrides that break the geometry), prompts with the game's pad glyphs and a Cancel that closes the menu. It shows the 0.5 gamepad features: `inputContext: menuMode`, the focus graph, `prompt` roles that switch glyphs by the active device (keyboard, Xbox, PlayStation), and the INI setting `[Prompts] Gamepad=xbox|playstation`.

- **Needs:** the Inkwell Runtime. Hotkey **F10**.
- **Deploy:** `yarn deploy:menu-gamepad` (to `Inkwell Menu Gamepad Test`). The prompts use the game's own `ControllerButtons` fonts; `INKWELL_VECTOR_GLYPHS=1` builds drawn glyphs instead.
- **Gamepad rules:** B (Cancel) closes the menu (close-only in 0.5); a focus graph needs `inputContext` menuMode; the runtime reports only "gamepad", so the glyph set is an INI choice. See `docs/gamepad.md`.
- Run in game on SE 1.7.104 (2026-10-28, owner): focus, A/B and the glyphs work.
