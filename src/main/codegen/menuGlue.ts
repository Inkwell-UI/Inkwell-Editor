import { BRIDGE_MEMBERS, BRIDGE_POLL_MAX, BRIDGE_POLL_MS } from '@inkwell-ui/spec'
import { ident } from '../../shared/overlay'
import type { ThemeKind } from './themeOps'

// The AS2 menu glue of a customMenu SWF (SPEC-CHANGES S7, docs/menus.md): the class `mods.<modId>.<Swf>Menu` that the frame code puts at `_root.inkwellMenu`
// and that the Inkwell Runtime calls (`_root.inkwellMenu.onOpen()`...). Pure text; the runtime-free Ruffle preview drives it through its mock bridge.

export interface MenuGlueInput {
  modId: string
  /** The SWF class stem (`Hud`); the class is `<swfCls>Menu`. */
  swfCls: string
  /** The graph classes in graph order (`cls` is the simple name from codegen). */
  graphs: readonly { cls: string; id: string }[]
  /** Clip paths from the base clip (`_root`) of layers whose overlay role is `button` or `list`: they are made focusable so On Focus / On Blur and Tab/arrow focus work. */
  focusable?: readonly string[]
  /** Keyed text layers (V13.2): clip paths from the base clip and their `$KEY`; `begin()` replaces the compiled source text with `bridge.translate(key)` when the runtime has an entry. */
  translated?: readonly { path: string; key: string }[]
  /** Runtime theming (V6.4): the modes of the themed collection and, per bound property, its clip path from the base clip, the kind of change and the value in every mode. `begin()` applies the mode the INI names. */
  themed?: { themes: readonly string[]; ops: readonly { path: string; kind: ThemeKind; values: Record<string, number | boolean> }[] }
  /** Full name of the generated list class when the SWF has a list: `onInput` forwards the user events to its `input` (S8). */
  listClass?: string
  /** Full name of the generated auto-layout class when the SWF has frames that re-lay out: a translated text calls its `touch`. */
  flowClass?: string
  /** The scroll class of the mod (frames that scroll in Figma): it gets the runtime's user events like the list class. */
  scrollClass?: string
  /** W3 focus graph: focusable clip paths from the base clip in focus order, and per path the index moved to on [Up, Down, Left, Right]. */
  focus?: { paths: readonly string[]; moves: readonly (readonly number[])[] }
  /** W4 prompts: per prompt the glyph clip paths [keyboard, xbox, playstation] (null = no glyph for that device). */
  prompts?: readonly (readonly (string | null)[])[]
  /** Dev build (S6): `dumpVariables()` asks every graph for its variables. The normal game build keeps the empty method. */
  dev?: boolean
}

export const menuClassName = (swfCls: string): string => `${swfCls}Menu`

/** The frame code that starts the glue; runs after every clip and class exists. */
export const menuFrameCode = (modId: string, swfCls: string): string[] => [
  `_root.inkwellMenu = new mods.${ident(modId)}.${menuClassName(swfCls)}(this);`,
  '_root.inkwellMenu.start();'
]

const safe = (s: string): string => JSON.stringify(s)

/** The stub bridge of S4.2: every member exists and does nothing (a missing runtime must not break the graphs). Built from the Spec's member table. */
function stubMembers(): string[] {
  const dflt: Record<string, string> = {
    ready: 'false', version: '0', menu: '""', uiScale: '1', offsetX: '0', offsetY: '0', theme: '""', language: '""',
    openMenu: 'function() { return false; }', closeMenu: 'function() { return false; }', callRuntime: 'function() { return ""; }', playSound: 'function() { return false; }',
    getSetting: 'function(section, key, defaultValue) { return defaultValue; }', getInputDevice: 'function() { return "keyboardMouse"; }', translate: 'function(key) { return key; }', getSaved: 'function(name, defaultValue) { return defaultValue; }'
  }
  return BRIDGE_MEMBERS.map((m) => `${m.name}: ${dflt[m.name] ?? 'noop'}`)
}

/** `applyTheme(name)` and its tables: an unknown name logs once and changes nothing (the baked default stays). */
function themeSource(t: NonNullable<MenuGlueInput['themed']>): string[] {
  const lit = (v: number | boolean): string => String(v)
  const byTheme = t.themes.flatMap((m) => {
    const ops = t.ops.filter((o) => o.values[m] !== undefined).map((o) => `[${safe(o.path)}, ${safe(o.kind)}, ${lit(o.values[m]!)}]`)
    return ops.length ? [`        if (name == ${safe(m)}) return [${ops.join(', ')}];`] : []
  })
  return [
    '    function applyTheme(name) {',
    '        if (name == undefined || name == "") return;',
    '        var ops = this.themeOps(name);',
    '        if (ops == undefined) {',
    `            var msg = "[Theme] unknown theme '" + name + "', keeping the default";`,
    '            this.bridge.log("warn", "", msg);',
    '            return;',
    '        }',
    '        for (var i = 0; i < ops.length; i++) {',
    '            var op = ops[i];',
    '            var o = this.base;',
    '            var parts = op[0].split(".");',
    '            for (var j = 0; j < parts.length; j++) o = o[parts[j]];',
    '            var v = op[2];',
    '            if (op[1] == "a") o._alpha = v;',
    '            else if (op[1] == "v") o._visible = v;',
    '            else if (op[1] == "w") o._width = v;',
    '            else if (op[1] == "h") o._height = v;',
    '            else if (op[1] == "t") o.textColor = v;',
    '            else if (op[1] == "c") new Color(o).setRGB(v);',
    '        }',
    '    }',
    '    // one table per theme: [clip path from the base clip, kind, value]; a mode without bound values is known but empty',
    '    function themeOps(name) {',
    ...byTheme,
    ...t.themes.filter((m) => !t.ops.some((o) => o.values[m] !== undefined)).map((m) => `        if (name == ${safe(m)}) return [];`),
    '        return undefined;',
    '    }'
  ]
}

export function menuClassSource(i: MenuGlueInput): string {
  const mod = ident(i.modId)
  const cls = menuClassName(i.swfCls)
  const create = i.graphs.flatMap((g, k) => [
    `        g = new mods.${mod}.${g.cls}(this.base);`,
    '        g.bridge = bridge;',
    `        this.base.inkwellGraph${k} = g;`,
    '        this.graphs.push(g);',
    `        try {`,
    '            g.init();',
    '        } catch (e) {',
    `            g.fail(${safe(g.id)}, e);`,
    '        }'
  ])
  const tx = (i.translated ?? []).map((t) => `        this.tx(this.base.${t.path}, ${safe(t.key)});`)
  const themeFns = i.themed ? themeSource(i.themed) : []
  const focus = (i.focusable ?? []).map((p) => `            this.base.${p}.tabEnabled = true;`)
  const fg = i.focus?.paths.length ? i.focus : undefined
  const pr = i.prompts?.length ? i.prompts : undefined
  const lit = (v: string | null): string => (v === null ? 'null' : safe(v))
  const lines = [
    `// Generated by Inkwell: the menu glue (SPEC-CHANGES S7). The Inkwell Runtime calls start/onOpen/onClose/onInput/onMessage/onModEvent/dumpVariables through _root.inkwellMenu. Do not edit.`,
    `class mods.${mod}.${cls} {`,
    '    var base;',
    '    var bridge;',
    '    var graphs;',
    '    var timer;',
    '    var polls;',
    ...(fg ? ['    var focusPaths;', '    var focusMoves;'] : []),
    ...(pr ? ['    var prompts;', '    var promptShown;', '    var promptPad;', '    var promptTimer;'] : []),
    `    function ${cls}(base) {`,
    '        this.base = base;',
    '        this.graphs = [];',
    '        this.polls = 0;',
    ...(fg ? [`        this.focusPaths = [${fg.paths.map(safe).join(', ')}];`, `        this.focusMoves = [${fg.moves.map((m) => `[${m.join(', ')}]`).join(', ')}];`] : []),
    ...(pr ? [`        this.prompts = [${pr.map((p) => `[${p.map(lit).join(', ')}]`).join(', ')}];`, '        this.promptShown = -1;', '        // W4: the keyboard glyphs until the runtime tells the device', '        this.showPrompts(0);'] : []),
    '    }',
    `    // S4.2 retry rule: the runtime installs _root.inkwell right after the movie loads and sets ready last. Poll every ${BRIDGE_POLL_MS} ms, up to ${BRIDGE_POLL_MAX} times, then run with a stub.`,
    '    function start() {',
    '        var self = this;',
    '        if (_root.inkwell.ready == true) {',
    '            this.begin(_root.inkwell);',
    '            return;',
    '        }',
    '        this.timer = setInterval(function() {',
    '            self.polls++;',
    '            if (_root.inkwell.ready == true) {',
    '                clearInterval(self.timer);',
    '                self.begin(_root.inkwell);',
    `            } else if (self.polls >= ${BRIDGE_POLL_MAX}) {`,
    '                clearInterval(self.timer);',
    '                trace("[Inkwell] inkwell bridge missing");',
    '                self.begin(self.stub());',
    '            }',
    `        }, ${BRIDGE_POLL_MS});`,
    '    }',
    '    function stub() {',
    '        var noop = function() {};',
    `        return { ${stubMembers().join(', ')} };`,
    '    }',
    '    function begin(bridge) {',
    '        this.bridge = bridge;',
    '        // UI scale and offset from the INI (S9): the 1920x1080 reference stage; untouched at the defaults',
    '        var s = Number(bridge.uiScale);',
    '        if (!(s > 0)) s = 1;',
    '        var ox = Number(bridge.offsetX) || 0;',
    '        var oy = Number(bridge.offsetY) || 0;',
    '        if (s != 1 || ox != 0 || oy != 0) {',
    '            _root._xscale = 100 * s;',
    '            _root._yscale = 100 * s;',
    '            _root._x = 960 * (1 - s) + ox;',
    '            _root._y = 540 * (1 - s) + oy;',
    '        }',
    ...(tx.length ? ['        // V13.2: the compiled text is the source language; the runtime answers with the game language, or with the key itself when it has no entry', ...tx] : []),
    ...(i.themed ? ['        // V6.4: the INI Theme key names a mode of the Figma variable collection; empty keeps the theme baked into the SWF', '        this.applyTheme(bridge.theme);'] : []),
    ...(focus.length ? ['        try {', ...focus, '        } catch (e) {', '        }'] : []),
    ...(fg
      ? [
          '        // W3: the focus graph moves focus on On Input; the arrow-key moves of GFx itself are switched off so they do not move it a second time',
          '        _global.gfxExtensions = true;',
          '        Selection.disableFocusKeys = true;',
          '        for (var f = 0; f < this.focusPaths.length; f++) {',
          '            var fc = this.clip(this.focusPaths[f]);',
          '            fc.tabEnabled = true;',
          '            fc.focusEnabled = true;',
          '        }'
        ]
      : []),
    ...(pr
      ? [
          '        // W4: the pad glyph style is the user choice (mod INI [Prompts] Gamepad=xbox|playstation); the device is polled, and checked on every input',
          '        this.promptPad = String(bridge.getSetting("Prompts", "Gamepad", "xbox")).toLowerCase() == "playstation" ? 2 : 1;',
          '        this.updatePrompts();',
          '        var me = this;',
          '        this.promptTimer = setInterval(function() {',
          '            me.updatePrompts();',
          '        }, 250);'
        ]
      : []),
    '        var g;',
    ...create,
    '        bridge.glueReady();',
    '    }',
    ...(tx.length ? ['    function tx(field, key) {', '        var t = this.bridge.translate(key);', '        if (t != undefined && t != key) {', '            field.text = t;', ...(i.flowClass ? [`            ${i.flowClass}.touch(field);`] : []), '        }', '    }'] : []),
    ...themeFns,
    ...(fg || pr ? ['    function clip(path) {', '        var o = this.base;', '        var p = path.split(".");', '        for (var k = 0; k < p.length; k++) o = o[p[k]];', '        return o;', '    }'] : []),
    ...(fg
      ? [
          '    // W3: Up/Down/Left/Right go to the configured target of the focused clip (the first one when none of the graph has focus); Accept is left to GFx (onPress/onRelease of the focused clip)',
          '    function moveFocus(action) {',
          '        var d = -1;',
          '        if (action == "Up") d = 0;',
          '        else if (action == "Down") d = 1;',
          '        else if (action == "Left") d = 2;',
          '        else if (action == "Right") d = 3;',
          '        if (d < 0) return;',
          '        var f = Selection.getFocus();',
          '        var k = -1;',
          '        for (var i = 0; i < this.focusPaths.length; i++) {',
          '            if (f == targetPath(this.clip(this.focusPaths[i]))) k = i;',
          '        }',
          '        Selection.setFocus(this.clip(this.focusPaths[k < 0 ? 0 : this.focusMoves[k][d]]));',
          '    }'
        ]
      : []),
    ...(pr
      ? [
          '    function updatePrompts() {',
          '        this.showPrompts(this.bridge.getInputDevice() == "gamepad" ? this.promptPad : 0);',
          '    }',
          '    // 0 keyboard, 1 Xbox, 2 PlayStation',
          '    function showPrompts(d) {',
          '        if (d == this.promptShown) return;',
          '        this.promptShown = d;',
          '        for (var k = 0; k < this.prompts.length; k++) {',
          '            var p = this.prompts[k];',
          '            for (var j = 0; j < 3; j++) {',
          '                if (p[j] != null) this.clip(p[j])._visible = j == d;',
          '            }',
          '        }',
          '    }'
        ]
      : []),
    '    function onOpen() {',
    ...(fg ? ['        Selection.setFocus(this.clip(this.focusPaths[0]));'] : []),
    '        for (var k = 0; k < this.graphs.length; k++) {',
    '            var g = this.graphs[k];',
    '            if (g.onOpen != undefined) g.onOpen();',
    '        }',
    '    }',
    '    function onClose() {',
    ...(pr ? ['        clearInterval(this.promptTimer);'] : []),
    '        for (var k = 0; k < this.graphs.length; k++) {',
    '            var g = this.graphs[k];',
    '            if (g.onClose != undefined) g.onClose();',
    '        }',
    '    }',
    '    function onInput(action) {',
    ...(pr ? ['        this.updatePrompts();'] : []),
    ...(fg ? ['        this.moveFocus(action);'] : []),
    ...(i.listClass ? [`        ${i.listClass}.input(action);`] : []),
    ...(i.scrollClass ? [`        ${i.scrollClass}.input(action);`] : []),
    '        for (var k = 0; k < this.graphs.length; k++) this.graphs[k].handleInput(action);',
    '    }',
    '    function onMessage(name, text, number, flag) {',
    '        for (var k = 0; k < this.graphs.length; k++) this.graphs[k].handleMessage(name, text, number, flag);',
    '    }',
    '    function onModEvent(name, strArg, numArg) {',
    '        for (var k = 0; k < this.graphs.length; k++) this.graphs[k].handleModEvent(name, strArg, numArg);',
    '    }',
    ...(i.dev
      ? [
          '    // dev build (S6): the runtime asks for a full dump when the editor subscribes to the watch',
          '    function dumpVariables() {',
          '        for (var k = 0; k < this.graphs.length; k++) {',
          '            try {',
          '                this.graphs[k].dumpVariables();',
          '            } catch (e) {',
          '            }',
          '        }',
          '    }'
        ]
      : ['    // dev builds report every variable through bridge.watch (S6, Phase 6); nothing to report yet', '    function dumpVariables() {', '    }']),
    '}',
    ''
  ]
  return lines.join('\n')
}
