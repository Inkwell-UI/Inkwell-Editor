// yarn deploy:menu-gamepad [--dev] [--dll <Inkwell.dll>] [--to <mods\name>]: the 0.5 Phase 3 gamepad test (TEST-IN-GAME-0.5.md, Phase 3 checks). samples/menu-gamepad (four buttons with a
// custom focus graph whose overrides break the geometry, an Accept and a Cancel prompt, hotkey F10) through the editor's own deploy path (menuDeploy.ts) into
// C:\Modding\MO2\mods\Inkwell Menu Gamepad Test, with the runtime DLL.
import { runMenuDeploy } from './menuDeploy'
void runMenuDeploy({ sample: 'menu-gamepad', envVar: 'INKWELL_MENU_GAMEPAD_DEPLOY', script: 'deploy:menu-gamepad' })
