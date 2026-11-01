// yarn deploy:menu-date-spike: see menuDeploy.ts. Deploys samples/menu-date-spike (hotkey F11) into the MO2 mod "Inkwell Date Spike": it shows whether Flash's Date class works in Skyrim.
import { runMenuDeploy } from './menuDeploy'
void runMenuDeploy({ sample: 'menu-date-spike', envVar: 'INKWELL_DATE_SPIKE_DEPLOY', script: 'deploy:menu-date-spike' })
