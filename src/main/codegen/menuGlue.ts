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
  graphs: readonly { cls: string; id: string; menu?: true }[]
  /** Clip paths from the base clip (`_root`) of layers whose overlay role is `button` or `list`: they are made focusable so On Focus / On Blur and Tab/arrow focus work. */
  focusable?: readonly string[]
  /** Keyed text layers (V13.2): clip paths from the base clip and their `$KEY`; `begin()` replaces the compiled source text with `bridge.translate(key)` when the runtime has an entry. */
  translated?: readonly { path: string; key: string }[]
  /** Runtime theming (V6.4): the modes of the themed collection and, per bound property, its clip path from the base clip, the kind of change and the value in every mode. `begin()` applies the mode the INI names. */
  themed?: { themes: readonly string[]; baked?: string; ops: readonly { path: string; kind: ThemeKind; values: Record<string, number | boolean> }[] }
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
  /** The game's own prompt art: per glyph clip the cached vanilla file (`../_vanilla/<file>.swf`), the sprite in it and the icon height. A failed load keeps the compiled glyph. */
  art?: readonly { clip: string; file: string; sprite: string; h: number }[]
  /** Preview build: the vanilla file comes from the Flash variable `inkwellArt_<file>` the preview window sets (a blob URL of the user's cached copy), else from `../_vanilla/`. Never in the game SWF. */
  previewArt?: boolean
  /** Dev build (S6): `dumpVariables()` asks every graph for its variables. The normal game build keeps the empty method. */
  dev?: boolean
  /** Design size of this SWF (a screen-shape variant is wider); UI scale grows from its centre. Default 1920x1080. */
  stage?: { width: number; height: number }
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
    '        this.theme = name;',
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
    '    // Set Theme: an unknown name changes nothing; a real change re-applies the bindings and tells the graphs (On Theme Changed)',
    '    function setTheme(name) {',
    '        if (this.themeOps(name) == undefined) {',
    `            this.bridge.log("warn", "", "[Theme] unknown theme '" + name + "', keeping the current one");`,
    '            return;',
    '        }',
    '        if (name == this.theme) return;',
    '        this.applyTheme(name);',
    '        for (var k = 0; k < this.graphs.length; k++) {',
    '            if (this.graphs[k].handleTheme != undefined) this.graphs[k].handleTheme(name);',
    '        }',
    '    }',
    '    // Cycle Theme: the next theme in the order of the Figma modes, the first after the last (or when the current one is not in the list)',
    '    function cycleTheme() {',
    `        var names = [${t.themes.map(safe).join(', ')}];`,
    '        var next = names[0];',
    '        for (var k = 0; k < names.length - 1; k++) {',
    '            if (names[k] == this.theme) next = names[k + 1];',
    '        }',
    '        this.setTheme(next);',
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
  // the menu graph starts first and is the `owner` of the layer graphs, which reach its global variables through it (`menuGraph()`)
  const hasMenuGraph = i.graphs.some((g) => g.menu)
  const ordered = [...i.graphs.filter((g) => g.menu), ...i.graphs.filter((g) => !g.menu)]
  const create = ordered.flatMap((g, k) => [
    `        g = new mods.${mod}.${g.cls}(this.base);`,
    '        g.bridge = bridge;',
    ...(hasMenuGraph && !g.menu ? ['        g.owner = this.graphs[0];'] : []),
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
  const art = pr && i.art?.length ? i.art : undefined
  const lit = (v: string | null): string => (v === null ? 'null' : safe(v))
  const lines = [
    `// Generated by Inkwell: the menu glue (SPEC-CHANGES S7). The Inkwell Runtime calls start/onOpen/onClose/onInput/onMessage/onModEvent/dumpVariables through _root.inkwellMenu. Do not edit.`,
    `class mods.${mod}.${cls} {`,
    '    var base;',
    '    var bridge;',
    '    var graphs;',
    '    var timer;',
    '    var polls;',
    ...(fg ? ['    var focusPaths;', '    var focusMoves;', '    var lastInput;', '    var curPath;'] : []),
    ...(pr ? ['    var prompts;', '    var promptShown;', '    var promptPad;', '    var promptTimer;'] : []),
    ...(art ? ['    var art;', '    var artLoaders;'] : []),
    ...(i.themed ? ['    var theme;'] : []),
    `    function ${cls}(base) {`,
    '        this.base = base;',
    '        this.graphs = [];',
    '        this.polls = 0;',
    ...(fg ? [`        this.focusPaths = [${fg.paths.map(safe).join(', ')}];`, `        this.focusMoves = [${fg.moves.map((m) => `[${m.join(', ')}]`).join(', ')}];`] : []),
    ...(pr ? [`        this.prompts = [${pr.map((p) => `[${p.map(lit).join(', ')}]`).join(', ')}];`, '        this.promptShown = -1;', '        // W4: the keyboard glyphs until the runtime tells the device', '        this.showPrompts(0);'] : []),
    ...(art ? [`        this.art = [${art.map((a) => `[${safe(a.clip)}, ${safe(a.file)}, ${safe(a.sprite)}, ${a.h}]`).join(', ')}];`] : []),
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
    `            _root._x = ${(i.stage?.width ?? 1920) / 2} * (1 - s) + ox;`,
    `            _root._y = ${(i.stage?.height ?? 1080) / 2} * (1 - s) + oy;`,
    '        }',
    ...(tx.length ? ['        // V13.2: the compiled text is the source language; the runtime answers with the game language, or with the key itself when it has no entry', ...tx] : []),
    ...(i.themed ? ['        // V6.4: the INI Theme key names a mode of the Figma variable collection; empty keeps the theme baked into the SWF', `        this.theme = ${safe(i.themed.baked ?? i.themed.themes[0] ?? '')}; // the theme in use (Get Theme, Set Theme)`, ...(i.themed.baked ? [`        this.applyTheme(${safe(i.themed.baked)}); // the baked theme first: layers only another theme shows are compiled and start hidden`] : []), '        this.applyTheme(bridge.theme);'] : []),
    ...(focus.length ? ['        try {', ...focus, '        } catch (e) {', '        }'] : []),
    ...(fg
      ? [
          '        // W3: the focus graph moves focus on On Input; the arrow-key moves of GFx itself are switched off so they do not move it a second time',
          '        _global.gfxExtensions = true;',
          '        Selection.disableFocusKeys = true;',
          // GFx also moves focus to the clip under the mouse (a list row is a button): the menu cursor moving would take focus from the focus graph
          '        Selection.disableFocusRolloverEvent = true;',
          // only the current member is focusable (setCur): GFx's own geometric moves, which the pad's key events still trigger, then have nowhere to go
          '        this.setCur(0);',
          // the keyboard reaches the menu as AS2 key events only (the runtime's On Input is the pad), and GFx's own arrow focus is off above: the key events go through the same handler
          ...(i.listClass ? [`        ${i.listClass}.gated = true;`] : []),
          '        var keyMe = this;',
          '        var keyL = new Object();',
          '        keyL.onKeyDown = function() {',
          '            keyMe.keyInput(Key.getCode());',
          '        };',
          '        Key.addListener(keyL);'
        ]
      : []),
    ...(pr
      ? [
          '        // W4: the pad glyph style is the user choice (mod INI [Prompts] Gamepad=xbox|playstation); the device is polled, and checked on every input',
          '        this.promptPad = String(bridge.getSetting("Prompts", "Gamepad", "xbox")).toLowerCase() == "playstation" ? 2 : 1;',
          '        this.updatePrompts();',
          ...(art ? ['        this.loadArt();'] : []),
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
          // the menu keeps the current member itself (curPath, shared with the lists): GFx may still move its own focus, and what we decide never depends on where it says the focus is
          '    function setCur(k) {',
          '        for (var i = 0; i < this.focusPaths.length; i++) {',
          '            var fc = this.clip(this.focusPaths[i]);',
          '            fc.tabEnabled = i == k;',
          '            fc.focusEnabled = i == k;',
          '        }',
          '        this.curPath = targetPath(this.clip(this.focusPaths[k]));',
          ...(i.listClass ? [`        ${i.listClass}.focusPath = this.curPath;`] : []),
          '    }',
          '    function curIndex() {',
          `        var cp = ${i.listClass ? `${i.listClass}.focusPath` : 'this.curPath'};`,
          '        for (var i = 0; i < this.focusPaths.length; i++) {',
          '            var fp = targetPath(this.clip(this.focusPaths[i]));',
          '            if (cp == fp || cp.substr(0, fp.length + 1) == fp + ".") return i;',
          '        }',
          '        return -1;',
          '    }',
          '    // W3: Up/Down/Left/Right go to the configured target of the focused clip (the first one when none of the graph has focus); Accept is left to GFx (onPress/onRelease of the focused clip)',
          '    function moveFocus(action) {',
          '        var d = -1;',
          '        if (action == "Up") d = 0;',
          '        else if (action == "Down") d = 1;',
          '        else if (action == "Left") d = 2;',
          '        else if (action == "Right") d = 3;',
          '        if (d < 0) return;',
          '        var f = Selection.getFocus();',
          '        // Set Focus Link: a link set at run time on the focused clip wins over the compiled table (elements made by Create Component)',
          '        var lk = eval(f).inkwellFocus[["up", "down", "left", "right"][d]];',
          '        if (lk != undefined) {',
          '            Selection.setFocus(lk);',
          '            return;',
          '        }',
          '        var k = this.curIndex();',
          '        var t = k < 0 ? 0 : this.focusMoves[k][d];',
          '        this.setCur(t);',
          '        Selection.setFocus(this.clip(this.focusPaths[t]));',
          '    }'
        ]
      : []),
    ...(pr
      ? [
          '    function updatePrompts() {',
          '        this.showPrompts(this.bridge.getInputDevice() == "gamepad" ? this.promptPad : 0);',
          '    }',
          ...(art
            ? [
                '    // The game\'s own prompt art: the runtime copies the vanilla menu SWFs to Interface/Inkwell/_vanilla/; a loose file resolves "..", the game\'s archive does not (S-M).',
                '    // The sprite is attached out of the loaded menu\'s own library and replaces the compiled glyph; any failure (file missing, sprite missing) keeps the compiled glyph.',
                '    function loadArt() {',
                '        this.artLoaders = [];',
                '        for (var k = 0; k < this.art.length; k++) {',
                '            var a = this.art[k];',
                '            var host = this.clip(a[0]).createEmptyMovieClip("inkwellArt", 1000);',
                '            var l = new MovieClipLoader();',
                '            l.a = a;',
                '            l.me = this;',
                '            l.onLoadInit = function(mc) {',
                '                for (var n in mc) {',
                '                    if (typeof(mc[n]) == "movieclip") {',
                '                        mc[n]._visible = false;',
                // The vanilla menu clip polls Init on every frame until the engine sets _codeObjInitialized; Ruffle never does, so it traced forever.
                ...(i.previewArt ? ['                        mc[n].onEnterFrame = null;'] : []),
                '                    }',
                '                }',
                '                var ic = mc.attachMovie(this.a[2], "ic", 9000);',
                ...(i.previewArt ? ['                trace("[Inkwell] prompt art: " + this.a[2] + " " + (ic == undefined ? "not found in " + this.a[1] + ".swf" : "ok " + ic._width + "x" + ic._height));'] : []),
                '                if (ic == undefined || !(ic._height > 0)) return;',
                '                var s = 100 * this.a[3] / ic._height;',
                '                ic._xscale = s;',
                '                ic._yscale = s;',
                '                this.me.hideDrawn(this.a[0]);',
                '            };',
                '            this.artLoaders.push(l);',
                ...(i.previewArt
                  ? [
                      '            var u = _root["inkwellArt_" + a[1]];',
                      '            if (u == undefined) u = "../_vanilla/" + a[1] + ".swf";',
                      '            l.onLoadError = function(mc, code) {',
                      '                trace("[Inkwell] prompt art: " + this.a[1] + ".swf not loaded (" + code + "); the drawn glyph stays");',
                      '            };',
                      '            l.loadClip(u, host);'
                    ]
                  : ['            l.loadClip("../_vanilla/" + a[1] + ".swf", host);']),
                '        }',
                '    }',
                '    function hideDrawn(path) {',
                '        this.clip(path).drawn._visible = false;',
                '    }'
              ]
            : []),
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
    ...(fg
      ? [
          '    // is the focus on a member of the focus graph (or inside one, a list row)?',
          '    function inGraph(f) {',
          '        for (var i = 0; i < this.focusPaths.length; i++) {',
          '            var p = targetPath(this.clip(this.focusPaths[i]));',
          '            if (f == p || f.substr(0, p.length + 1) == p + ".") return true;',
          '        }',
          '        return false;',
          '    }'
        ]
      : []),
    '    function onOpen() {',
    ...(fg ? ['        Selection.setFocus(this.clip(this.focusPaths[0]));', ...(i.listClass ? [`        ${i.listClass}.sync();`] : [])] : []),
    '        for (var k = 0; k < this.graphs.length; k++) {',
    '            var g = this.graphs[k];',
    '            if (g.onOpen != undefined) g.onOpen();',
    '        }',
    // an On Open graph fills lists and the first set-focus above found them empty (GFx may refuse an empty clip): if the focus is not in the graph now, take the first member again
    ...(fg ? ['        if (!this.inGraph(Selection.getFocus())) Selection.setFocus(this.clip(this.focusPaths[0]));', ...(i.listClass ? [`        ${i.listClass}.sync();`] : [])] : []),
    '    }',
    '    function onClose() {',
    ...(pr ? ['        clearInterval(this.promptTimer);'] : []),
    '        for (var k = 0; k < this.graphs.length; k++) {',
    '            var g = this.graphs[k];',
    '            if (g.onClose != undefined) g.onClose();',
    '        }',
    '    }',
    ...(fg
      ? [
          '    function onInput(action) {',
          '        this.lastInput = getTimer();',
          '        this.handle(action);',
          '    }',
          // arrows and Enter as AS2 key codes (Flash codes, and the DirectInput scan codes the runtime traces); the pad also sends key events right after On Input: those are ignored for 150 ms
          '    function keyInput(code) {',
          '        if (getTimer() - this.lastInput < 150) return;',
          '        var a = "";',
          '        if (code == 38 || code == 200) a = "Up";',
          '        else if (code == 40 || code == 208) a = "Down";',
          '        else if (code == 37 || code == 203) a = "Left";',
          '        else if (code == 39 || code == 205) a = "Right";',
          '        else if (code == 13 || code == 28 || code == 69 || code == 18) a = "Accept";',
          '        if (a != "") this.handle(a);',
          '    }'
        ]
      : []),
    `    function ${fg ? 'handle' : 'onInput'}(action) {`,
    // GFx may have moved its own focus since the last press: put it back on the member we are in (Accept presses the focused clip)
    ...(fg ? ['        var ck = this.curIndex();', '        if (ck >= 0) Selection.setFocus(this.clip(this.focusPaths[ck]));'] : []),
    ...(pr ? ['        this.updatePrompts();'] : []),
    ...(fg && i.listClass
      ? [`        if (!${i.listClass}.input(action, true)) this.moveFocus(action);`, `        ${i.listClass}.sync();`]
      : [...(fg ? ['        this.moveFocus(action);'] : []), ...(i.listClass ? [`        ${i.listClass}.input(action);`] : [])]),
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
