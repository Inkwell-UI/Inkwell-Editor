// yarn deploy:menu-themes [--dev] [--dll <Inkwell.dll>] [--to <mods\name>]: the 0.4 theme test (TEST-IN-GAME-0.4.md section 10). A throw-away copy of samples/menu-slice with a two-mode Figma variable
// collection ("Colors": Vanilla, Nordic) bound to the title and status text colour (runtime), the button background tint (runtime, its stroke removed) and the panel opacity (runtime) and
// fill (compile time only: it has a stroke), deployed through the editor's own deploy path (menuDeploy.ts). Nothing is committed to the sample.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { stableStringify } from '../src/main/project'
import { runMenuDeploy } from './menuDeploy'

const NS = 'InkwellMenuTheme'
const c = (r: number, g: number, b: number) => ({ r: r / 255, g: g / 255, b: b / 255 })

void runMenuDeploy({
  sample: 'menu-slice',
  envVar: 'INKWELL_MENU_THEME_DEPLOY',
  script: 'deploy:menu-themes',
  prepare: async (dir) => {
    const read = (f: string): Record<string, any> => JSON.parse(readFileSync(resolve(dir, f), 'utf8'))
    const write = (f: string, v: unknown): void => writeFileSync(resolve(dir, f), stableStringify(v))
    write('project.json', { ...read('project.json'), modId: NS, name: 'Inkwell Menu Theme Test', deploy: { preset: 'mo2', path: 'C:/Modding/MO2/mods/Inkwell Menu Theme Test' } })
    const ir = read('swfs/menu/ir.json')
    const v = (name: string, type: 'color' | 'number', vanilla: unknown, nordic: unknown) => ({ name, type, values: { Vanilla: vanilla, Nordic: nordic } })
    ir['themes'] = [{
      name: 'Colors', modes: ['Vanilla', 'Nordic'],
      variables: {
        'V:title': v('colors/title', 'color', c(255, 255, 255), c(140, 220, 255)),
        'V:status': v('colors/status', 'color', c(200, 200, 200), c(255, 200, 80)),
        'V:button': v('colors/button', 'color', c(31, 144, 112), c(40, 90, 200)),
        'V:panel': v('colors/panel', 'color', c(16, 18, 42), c(60, 20, 20)),
        'V:panelAlpha': v('alpha/panel', 'number', 1, 0.5)
      }
    }]
    const bind = (id: string, b: Record<string, { id: string }>, over: Record<string, unknown> = {}): void => { ir.nodes[id] = { ...ir.nodes[id], ...over, bindings: b } }
    bind('2:2', { 'runs/0/fill/color': { id: 'V:title' } })
    bind('2:4', { 'runs/0/fill/color': { id: 'V:status' } })
    bind('3:1', { 'fills/0/color': { id: 'V:button' } }, { strokes: [] })
    bind('2:1', { 'fills/0/color': { id: 'V:panel' }, opacity: { id: 'V:panelAlpha' } })
    write('swfs/menu/ir.json', ir)
  }
})
