// yarn deploy:menu-i18n [--dev] [--dll <Inkwell.dll>] [--to <mods\name>]: the 0.4 test of the whole pipeline in one menu (TEST-IN-GAME-0.4.md section 8). It deploys a throw-away copy of
// samples/menu-slice with an EMBEDDED CUSTOM FONT on the title (Share Tech Mono, OFL, from resources/preview-fonts), KEYED TEXTS and a localization.json with English and German,
// through the editor's own deploy path (see menuDeploy.ts). The font and the keys are added to the copy only: nothing binary is committed to the sample.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { addFont } from '../src/main/project/fontFiles'
import { stableStringify } from '../src/main/project'
import { runMenuDeploy } from './menuDeploy'

const root = resolve(__dirname, '..')
const NS = 'InkwellMenuI18n'

void runMenuDeploy({
  sample: 'menu-slice',
  envVar: 'INKWELL_MENU_I18N_DEPLOY',
  script: 'deploy:menu-i18n',
  prepare: async (dir) => {
    const font = await addFont(dir, readFileSync(resolve(root, 'resources/preview-fonts/ShareTechMono-Regular.ttf')), 'ShareTechMono-Regular.ttf')
    if (!font.ok) throw new Error(font.error)
    const read = (f: string): Record<string, any> => JSON.parse(readFileSync(resolve(dir, f), 'utf8'))
    const write = (f: string, v: unknown): void => writeFileSync(resolve(dir, f), stableStringify(v))
    // its own mod: another id, another MO2 folder, another menu name and hotkey slot (F8 stays; enable only one of the Inkwell test mods)
    const project = read('project.json')
    write('project.json', { ...project, modId: NS, name: 'Inkwell Menu I18n Test', deploy: { preset: 'mo2', path: 'C:/Modding/MO2/mods/Inkwell Menu I18n Test' } })
    const overlay = read('swfs/menu/overlay.json')
    overlay['nodes'] = {
      ...overlay['nodes'],
      '2:2': { locKey: `$${NS}_Title`, font: font.font.hash },
      '2:4': { ...overlay['nodes']['2:4'], locKey: `$${NS}_Status` },
      '3:2': { locKey: `$${NS}_Button` }
    }
    write('swfs/menu/overlay.json', overlay)
    write('localization.json', {
      specVersion: 7, namespace: NS, source: 'ENGLISH', languages: ['ENGLISH', 'GERMAN'],
      entries: {
        [`$${NS}_Title`]: { ENGLISH: 'INKWELL MENU SLICE', GERMAN: 'INKWELL MENÜ BEISPIEL' },
        [`$${NS}_Status`]: { ENGLISH: 'Waiting for a click', GERMAN: 'Warte auf einen Klick' },
        [`$${NS}_Button`]: { ENGLISH: 'Click me', GERMAN: 'Klick mich' }
      }
    })
  }
})
