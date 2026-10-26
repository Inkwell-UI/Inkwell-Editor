// yarn deploy:menu-nodes: see menuDeploy.ts (the shared code; also used by deploy:menu-slice). Default mod folder: C:\Modding\MO2\mods\Inkwell Menu Nodes Test.
import { runMenuDeploy } from './menuDeploy'
void runMenuDeploy({ sample: 'menu-nodes', envVar: 'INKWELL_MENU_NODES_DEPLOY', script: 'deploy:menu-nodes' })
