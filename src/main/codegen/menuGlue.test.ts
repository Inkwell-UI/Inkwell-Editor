// The menu glue (SPEC-CHANGES S7, docs/menus.md) without FFDec: golden AS2 of the menu class and of a menu-flavoured graph class, the frame code, the preview mock bridge.
// The FFDec compile and the Ruffle run are menuGlue.integration.test.ts and the screenshotMenu driver.
import { resolve } from 'node:path'
import { Swf, BRIDGE_MEMBERS, MENU_CLASS_MEMBERS } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { defIndex } from '../../shared/graphs'
import { validateGraph } from '../../shared/graphValidate'
import { loadPacks } from '../packs'
import { loadProject } from '../project'
import { generate } from '../swf/generate'
import { corePack } from './codegen.testutil'
import { generateGraphClasses, toBridgeLog } from './codegen'
import { menuClassSource, menuFrameCode } from './menuGlue'
import { loadCodegenPacks } from './packs'

const sample = resolve(__dirname, '../../../samples/menu-slice')
const load = async () => {
  const project = await loadProject(sample)
  const s = project.swfs['menu']!
  const { packs } = await loadCodegenPacks([corePack])
  const nodes = (s.overlay as { nodes: Record<string, { instanceName?: string; role?: string }> }).nodes
  return {
    project, ir: Swf.parse(s.ir), graphs: Object.values(s.graphs ?? {}), packs,
    instanceNames: Object.fromEntries(Object.entries(nodes).flatMap(([id, o]) => (o.instanceName ? [[id, o.instanceName]] : []))),
    roles: Object.fromEntries(Object.entries(nodes).flatMap(([id, o]) => (o.role ? [[id, o.role]] : [])))
  }
}

describe('samples/menu-slice', () => {
  it('has no graph issues as a custom menu; as a HUD widget its On Click is runtime-required (a warning)', async () => {
    const { ir, graphs } = await load()
    const defs = defIndex(await loadPacks([corePack]))
    const layers = new Set(Object.keys(ir.nodes))
    expect(graphs).toHaveLength(1)
    expect(validateGraph(graphs[0]!, { defs, layers, siblings: graphs, target: 'customMenu' })).toEqual([])
    expect(validateGraph(graphs[0]!, { defs, layers, siblings: graphs, target: 'hudWidget' }).map((i) => [i.code, i.level, i.nodeId])).toEqual([['runtime-required', 'warning', 'click']])
  })
})

describe('menu class', () => {
  it('golden AS2 for two graphs and a focusable button', () => {
    const src = menuClassSource({ modId: 'MyMod', swfCls: 'Wheel', graphs: [{ cls: 'WheelGraph_main', id: 'main' }, { cls: 'WheelGraph_list', id: 'list' }], focusable: ['btn', 'rows'] })
    expect(src).toMatchSnapshot()
  })
  it('has every member the runtime invokes (S7) and the S4.2 retry numbers', () => {
    const src = menuClassSource({ modId: 'M', swfCls: 'X', graphs: [] })
    for (const m of MENU_CLASS_MEMBERS) expect(src).toContain(`function ${m}(`)
    expect(src).toContain('}, 50);')
    expect(src).toContain('self.polls >= 100')
    expect(src).toContain('inkwell bridge missing')
    expect(src).toContain('bridge.glueReady();')
  })
  it('the stub bridge has every member of the Spec table, so a missing runtime cannot break a graph', () => {
    const src = menuClassSource({ modId: 'M', swfCls: 'X', graphs: [] })
    const stub = src.split('\n').find((l) => l.includes('return { ready:'))!
    for (const m of BRIDGE_MEMBERS) expect(stub).toContain(`${m.name}:`)
  })
  it('frame code creates _root.inkwellMenu and starts it', () => {
    expect(menuFrameCode('My Mod', 'Wheel')).toEqual(['_root.inkwellMenu = new mods.My_Mod.WheelMenu(this);', '_root.inkwellMenu.start();'])
  })
  describe('UI scale and offset from the INI (S2, S9)', () => {
    const src = menuClassSource({ modId: 'M', swfCls: 'X', graphs: [] })
    const block = src.slice(src.indexOf('        var s = Number(bridge.uiScale);'), src.indexOf('        var g;'))
    it('golden block: applied to the menu root at start, once, in the 1920x1080 reference stage', () => {
      expect(block).toMatchInlineSnapshot(`
        "        var s = Number(bridge.uiScale);
                if (!(s > 0)) s = 1;
                var ox = Number(bridge.offsetX) || 0;
                var oy = Number(bridge.offsetY) || 0;
                if (s != 1 || ox != 0 || oy != 0) {
                    _root._xscale = 100 * s;
                    _root._yscale = 100 * s;
                    _root._x = 960 * (1 - s) + ox;
                    _root._y = 540 * (1 - s) + oy;
                }
        "
      `)
    })
    // the AS2 of the block is also valid JavaScript, so run it against a fake root
    const run = (bridge: Record<string, unknown>): Record<string, number> => {
      const _root: Record<string, number> = { _xscale: 100, _yscale: 100, _x: 0, _y: 0 }
      new Function('bridge', '_root', 'Number', block)(bridge, _root, Number)
      return _root
    }
    it('scales around the stage centre and adds the offset', () => {
      expect(run({ uiScale: 1.5, offsetX: 40, offsetY: -20 })).toEqual({ _xscale: 150, _yscale: 150, _x: 960 * -0.5 + 40, _y: 540 * -0.5 - 20 })
      expect(run({ uiScale: 0.5, offsetX: 0, offsetY: 0 })).toEqual({ _xscale: 50, _yscale: 50, _x: 480, _y: 270 })
    })
    it('leaves the root alone at the defaults, and treats a broken scale as 1', () => {
      const untouched = { _xscale: 100, _yscale: 100, _x: 0, _y: 0 }
      expect(run({ uiScale: 1, offsetX: 0, offsetY: 0 })).toEqual(untouched)
      for (const bad of [undefined, 0, -2, NaN, 'abc']) expect(run({ uiScale: bad, offsetX: 0, offsetY: 0 }), String(bad)).toEqual(untouched)
      expect(run({ uiScale: 1, offsetX: 'x', offsetY: undefined })).toEqual(untouched) // a broken offset is 0
      expect(run({ uiScale: 1, offsetX: 25, offsetY: 0 })._x).toBe(25) // the offset alone moves the menu
    })
    it('the stub bridge (no runtime) is scale 1 at 0,0', () => {
      expect(src).toContain('uiScale: 1, offsetX: 0, offsetY: 0')
    })
  })
  it('no focus block and no graphs without them', () => {
    const src = menuClassSource({ modId: 'M', swfCls: 'X', graphs: [] })
    expect(src).not.toContain('tabEnabled')
    expect(src).not.toContain('new mods.M.XGraph')
  })
})

describe('menu-flavoured graph class', () => {
  it('rewrites the Log trace to the bridge, fail goes through log, and the message/mod event registries exist', async () => {
    const { graphs, packs } = await load()
    const common = { modId: 'InkwellMenuTest', swfCls: 'Menu', graphs, packs, layerPath: (id: string) => ({ '2:3': 'btn', '2:4': 'status' })[id] }
    const hud = generateGraphClasses(common).classes[0]!.source
    const menu = generateGraphClasses({ ...common, menu: true }).classes[0]!.source
    expect(hud).toContain('trace("[Inkwell] info log: " + "button clicked");')
    expect(hud).not.toContain('bridge')
    expect(menu).toContain('__g.log("info", "log", "button clicked");')
    expect(menu).not.toContain('trace("[Inkwell] info')
    expect(menu).toContain('this.log("error", nodeId, msg);')
    for (const m of ['addMessageHandler', 'handleMessage', 'addModEventHandler', 'handleModEvent']) expect(menu).toContain(`function ${m}(`)
    expect(menu).toContain('__g.base.btn.onRelease = function()')
    expect(menu).toMatchSnapshot()
  })
  it('toBridgeLog leaves other lines alone and keeps escaped quotes', () => {
    expect(toBridgeLog('    x.y = 1;')).toBe('    x.y = 1;')
    expect(toBridgeLog('trace("[Inkwell] warn n\\"1: " + (a + b));')).toBe('__g.log("warn", "n\\"1", (a + b));')
  })
})

describe('generate() for a customMenu SWF', () => {
  it('the game SWF has the menu class and starts it; no mock bridge', async () => {
    const { project, ir, graphs, packs, instanceNames, roles } = await load()
    const g = generate(ir, { modId: project.meta.modId, instanceNames, roles, graphs: { graphs, packs } })
    expect(g.lint.filter((l) => l.severity === 'error')).toEqual([])
    const cls = g.as2.find((f) => f.path.endsWith('MenuMenu.as'))!.source
    expect(cls).toContain('new mods.InkwellMenuTest.MenuGraph_main(this.base)')
    expect(cls).toContain('this.base.btn.tabEnabled = true;')
    const frame = g.as2.find((f) => f.path === 'frame_1/DoAction.as')!.source
    expect(frame).toContain('_root.inkwellMenu.start();')
    expect(frame).not.toContain('inkwellGraph0 = new')
    expect(frame).not.toContain('_root.inkwell = {')
    expect(g.as2.find((f) => f.path.endsWith('MenuGraph_main.as'))!.source).toContain('var bridge;')
  })
  it('the preview SWF installs the mock bridge before the menu starts and offers the Play panel callbacks', async () => {
    const { project, ir, graphs, packs, instanceNames, roles } = await load()
    const g = generate(ir, { modId: project.meta.modId, instanceNames, roles, graphs: { graphs, packs }, preview: true })
    const frame = g.as2.find((f) => f.path === 'frame_1/DoAction.as')!.source
    expect(frame.indexOf('_root.inkwell = {')).toBeGreaterThan(-1)
    expect(frame.indexOf('_root.inkwell = {')).toBeLessThan(frame.indexOf('_root.inkwellMenu = new'))
    for (const m of BRIDGE_MEMBERS) expect(frame.split('_root.inkwell = {')[1]!.split('};')[0]).toContain(`${m.name}`)
    expect(frame).toContain('"inkwellClick"')
    // the preview's UI Scale control: the bridge values change, the root is reset and the menu class restarted (the Ruffle driver checks the effect)
    expect(frame).toContain('"inkwellUiScale"')
    expect(frame).toContain('_root.inkwell.uiScale = Number(scale) || 1;')
    expect(frame.indexOf('_root._xscale = 100;')).toBeLessThan(frame.indexOf('_root.inkwellMenu = new', frame.indexOf('var reopen')))
    expect(frame).toContain('_global.Inkwell.paths["2:3"] = "btn";')
  })
  it('a customMenu without graphs still gets the glue (the runtime waits for glueReady)', async () => {
    const { project, ir } = await load()
    const g = generate(ir, { modId: project.meta.modId })
    expect(g.as2.find((f) => f.path.endsWith('MenuMenu.as'))!.source).not.toContain('new mods.InkwellMenuTest.MenuGraph')
    expect(g.as2.find((f) => f.path === 'frame_1/DoAction.as')!.source).toContain('_root.inkwellMenu.start();')
  })
  it('a hudWidget is unchanged: no menu class, no bridge', async () => {
    const { project, ir } = await load()
    const g = generate({ ...ir, target: { kind: 'hudWidget' } }, { modId: project.meta.modId })
    expect(g.as2.some((f) => f.path.endsWith('MenuMenu.as'))).toBe(false)
    expect(g.as2.map((f) => f.source).join(' ')).not.toContain('inkwellMenu')
  })
})
