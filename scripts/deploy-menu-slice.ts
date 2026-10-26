// yarn deploy:menu-slice: see menuDeploy.ts (the shared code; also used by deploy:menu-nodes).
import { runMenuDeploy } from './menuDeploy'
void runMenuDeploy({ sample: 'menu-slice', envVar: 'INKWELL_MENU_DEPLOY', script: 'deploy:menu-slice' })
