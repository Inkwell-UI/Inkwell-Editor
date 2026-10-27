import { FOCUS_DIRS, type FocusGraph, type Graph, type MergedContract, type PromptDevice, type Swf } from '@inkwell-ui/spec'
import { glyphId, glyphOwner, isGlyphNode, PROMPT_DEVICE_ORDER, withPromptGlyphs } from './promptGlyphs'
import { ddsRel, isAssetHash, type ImageMode } from '../images/assets'
import type { Rgba } from '../images/png'
import { ident } from '../../shared/overlay'
import { issue, type LintIssue } from './lint'
import { maskSvg, rectSvg, shapeToSvg } from './svg'
import * as T from './tags'
import { mapText, previewDeviceFont, type FontInfo, type GlyphLookup, type TextScript } from './text'
import { HUD_SCALE, widgetFrame } from '../widget/frame'
import { widgetContractClass } from '../widget/widgetAs2'
import { packVersion, FIRST_RUNTIME_VERSION, themeModes } from '@inkwell-ui/spec'
import { generateGraphClasses, type GraphClass, type WidgetCall } from '../codegen/codegen'
import { menuClassName, menuClassSource, menuFrameCode } from '../codegen/menuGlue'
import { replacementClassName, replacementFrameCode, replacementGlue } from '../codegen/replacementGlue'
import { themeOps } from '../codegen/themeOps'
import type { CodegenPacks } from '../codegen/packs'
import { listAttachCode, listClassName, listClassSource, type ListInfo } from './listAs2'

export interface GenerateOptions {
  /** Characters the font behind an alias can draw (lint `font-missing-glyph`); omitted or undefined for an alias: not checked. */
  glyphs?: GlyphLookup
  /** Visual-scripting graphs of this SWF compiled to AS2 classes (docs/codegen.md). Absent or empty: nothing is added, the output is unchanged. */
  graphs?: { graphs: readonly Graph[]; packs: CodegenPacks }
  /** Overlay `dataBinding` strings by Figma layer id; applied by the graph classes (docs/codegen.md, Data binding). Without graphs nothing is bound. */
  bindings?: Record<string, string>
  /** Overlay `role` by Figma layer id. A customMenu SWF makes its `button` and `list` layers focusable, and the preview's Play panel can click the `button` ones. */
  roles?: Record<string, string>
  /**
   * Embedded custom fonts (V5): overlay `font` (a font asset hash) by Figma layer id, and per hash the family, the natural line height and the characters to embed (a DefineFont3 placeholder
   * per font in the SWF; the compile step imports the glyph outlines of `chars` from the font file with FFDec). A hash without an entry is the lint error `font-file-missing`.
   */
  embeddedFonts?: { byNode: Record<string, string>; fonts: Record<string, { family: string; lineHeight?: number; chars: string }> }
  /** Overlay `locKey` by Figma layer id (V2): a keyed text of a custom menu is translated at start by `inkwell.translate(key)`; the compiled text stays the source language. */
  locKeys?: Record<string, string>
  /** Overlay `list` settings (S8: item template layer, row spacing) by Figma layer id, for layers whose role is `list`. */
  lists?: Record<string, { itemTemplate?: string; spacing?: number }>
  /** Mod id: AS2 classes live under `mods.<modId>.*`. */
  modId: string
  /** Overlay instance names by node id; the default is the sanitized layer name. */
  instanceNames?: Record<string, string>
  /** HUD widget output: the first frame becomes the root clip `widget` (SkyUI contract AS2, scaled 2/3 into the 1280x720 HUD space). */
  widget?: boolean
  /** Widget only: text node ids that Papyrus can set (overlay role `text`); the widget clip gets `setTexts`, `show`, `hide` (see widgetAs2.ts). */
  settableTexts?: ReadonlySet<string>
  /**
   * Preview SWF for Ruffle: the same content, but text uses a device font (no ImportAssets2, no fontId/outlines), the frame code starts
   * with the preview shims (skse, gfxExtensions, bridge stubs), and `widget` is ignored: the design frame shows at the design size.
   */
  preview?: boolean
  /** Custom menu only: the dev flavour of the game SWF (graph `pin`/`watch` calls and `dumpVariables`, S6/S7); a dev deploy ships it, Package Mod never does. Ignored by the preview. */
  dev?: boolean
  /** Preview only: device font name per alias (a font Ruffle has loaded by name); default `previewDeviceFont` (_sans, _typewriter, _serif). */
  previewFont?: (alias: string) => string
  /**
   * Preview only: TTF bytes for a font name. A name that has bytes is EMBEDDED (placeholder DefineFont3 + fontId + outlines; the glyphs are
   * imported by the FFDec `fonts` step), because Ruffle draws device-font text nothing when rotated or alpha-blended. Others stay device fonts.
   */
  previewFontBytes?: (fontName: string) => Buffer | undefined
  /**
   * How bitmaps reach the game (project setting `imageMode`, see docs/images.md): 'embedded' (default) compiles them into the SWF
   * (DefineBitsLossless2); 'dds' places an empty clip per image and AS2 loads `img://textures/Inkwell/<mod>/<hash>.dds` into it. The preview always embeds.
   */
  imageMode?: ImageMode
  /** Decoded pixels by image hash (the project's assets/<hash>.png); undefined = missing (lint `image-missing-asset`). */
  images?: (hash: string) => Rgba | undefined
  /** Menu replacement only: the merged contract (`lint/contract.ts` `contractFor`); the SWF gets the engine glue built from it (`codegen/replacementGlue.ts`). */
  contract?: MergedContract
  /** Custom menu: the SWF's focus graph (Spec `focusGraph`, W3); the menu class moves focus on On Input Up/Down/Left/Right by it. Empty order = GFx's own focus handling. */
  focus?: Pick<FocusGraph, 'order' | 'moves'>
  /** Custom menu: role-`prompt` frames (W4) and their glyph per device (Spec `resolvePrompt`); the glyphs are compiled in and the menu class shows the active device's. */
  prompts?: Record<string, Partial<Record<PromptDevice, string>>>
}

export interface Generated {
  /** Complete tag list, ready for `writeSwf` (ends with ShowFrame + End). */
  tags: Buffer[]
  /** SVG per shape, keyed by SWF character id (the file name FFDec -importShapes expects) and mapped to its node id. */
  shapes: { charId: number; nodeId: string; svg: string }[]
  /** AS2 files relative to the scripts folder. */
  as2: { path: string; source: string }[]
  lint: LintIssue[]
  /** One entry per text node: how its font resolved. Not lint. */
  fonts: (FontInfo & { nodeId: string; nodeName: string })[]
  stage: { width: number; height: number }
  /** Preview only: embedded fonts (placeholder character id, font name, characters to import: the text plus printable ASCII). */
  embeddedFonts: { charId: number; name: string; chars: string; /** An embedded custom font (V5): its asset hash; absent = a preview device font by `name`. */ hash?: string }[]
  /** Text nodes that need GFx TextField extensions (verticalAlign, textAutoSize, letterSpacing); Ruffle ignores the first two. */
  gfxTextExtensions: number
  /** Images the game SWF loads at runtime from DDS (dds mode; 0 when embedded or in the preview). */
  ddsImages: number
  /** Widget only: the compiled settable text fields in layer order (`name` = instance name, `path` relative to the `widget` clip). */
  settableTexts: SettableText[]
  /** Custom menu: the keyed text layers (`path` from the base clip) the menu class translates at start (V13.2). Empty for widgets and without keys. */
  translatedTexts: { nodeId: string; path: string; key: string }[]
  /** The generated graph classes with their source maps (empty without graphs). */
  graphClasses: GraphClass[]
  /** On Widget Call signatures of all graphs: the Papyrus API of a widget. */
  graphCalls: WidgetCall[]
  /** Compiled clip path of every placed layer (`root.a.b`, figma node id -> path): what contract validation checks. */
  layerPaths: Record<string, string>
  /** Menu replacement: what the engine glue defines (contract path -> AS2 type), checked with `layerPaths` by the contract lint. Empty otherwise. */
  contractProvided: Record<string, string>
}

export interface SettableText {
  nodeId: string
  layer: string
  name: string
  path: string
}

/**
 * Preview only (docs/debugging.md): the callbacks the editor calls through Ruffle's ExternalInterface. `inkwellCall(name, args)` runs the clip method of an
 * On Widget Call (what Papyrus does in game); `inkwellGet("Hud.title.text")` reads a value from the movie (a debugging and test aid), `inkwellMockReset()` / `inkwellMock(key, value)` replace the mock values and `inkwellMockDone()` tells the graph classes
 * (`Inkwell.mockListeners`) to re-read them.
 */
const PREVIEW_BRIDGE = [
  '_global.Inkwell.mock = {};',
  '_global.Inkwell.mockListeners = [];',
  'try {',
  '    flash.external.ExternalInterface.addCallback("inkwellCall", null, function(name, args) {',
  '        var f = _root[name];',
  '        if (typeof (f) != "function") return false;',
  '        f.call(_root, args);',
  '        return true;',
  '    });',
  '    flash.external.ExternalInterface.addCallback("inkwellGet", null, function(path) {',
  '        var o = _root;',
  '        var p = String(path).split(".");',
  '        for (var k = 0; k < p.length; k++) o = o[p[k]];',
  '        return o;',
  '    });',
  '    flash.external.ExternalInterface.addCallback("inkwellMockReset", null, function() {',
  '        _global.Inkwell.mock = {};',
  '        return true;',
  '    });',
  '    flash.external.ExternalInterface.addCallback("inkwellMock", null, function(key, value) {',
  '        _global.Inkwell.mock[key] = value;',
  '        return true;',
  '    });',
  '    flash.external.ExternalInterface.addCallback("inkwellMockDone", null, function() {',
  '        var l = _global.Inkwell.mockListeners;',
  '        for (var k = 0; k < l.length; k++) l[k]();',
  '        return true;',
  '    });',
  '} catch (e) {',
  '    trace("[Inkwell] preview bridge unavailable: " + e);',
  '}'
]

/**
 * Preview only, customMenu SWFs: stands in for the Inkwell Runtime (SPEC-CHANGES S4.2). `_root.inkwell` has every member of the Spec's BRIDGE_MEMBERS table; `log` prints the
 * trace line the Trace panel parses; `glueReady` plays the runtime's next step (the menu opens). Callbacks for the Play panel: `inkwellMenuOpen` / `inkwellMenuClose` call
 * the menu class like the runtime does, `inkwellClick(nodeId)` fires `onRelease` of a role-`button` layer (`_global.Inkwell.paths`). Never part of the game SWF.
 */
const previewMenuBridge = (menuName: string, menuClass: string, paths: Record<string, string>, attach: readonly string[]): string[] => [
  `_root.inkwell = {`,
  `    ready: true, version: ${packVersion(FIRST_RUNTIME_VERSION)}, menu: ${JSON.stringify(menuName)}, uiScale: 1, offsetX: 0, offsetY: 0, theme: "", language: "", saved: {}, depth: 0, reopens: 0,`,
  '    log: function(level, nodeId, text) { trace("[Inkwell] " + level + " " + nodeId + ": " + text); },',
  '    glueReady: function() { _root.inkwellMenu.onOpen(); },',
  // mock: nothing leaves the movie. A mod event sent by the menu comes back to it (the real runtime does this only if it also sinks the event: unverified)
  '    openMenu: function(name) { _root.inkwell.log("info", "", "mock openMenu " + name); return true; }, closeMenu: function(name) { _root.inkwell.log("info", "", "mock closeMenu " + name); return true; },',
  '    sendModEvent: function(e, s, n) {',
  '        _root.inkwell.log("info", "", "mock sendModEvent " + e + " (" + s + ", " + n + ")");',
  '        if (_root.inkwell.depth > 4) return;',
  '        _root.inkwell.depth++;',
  '        try { _root.inkwellMenu.onModEvent(e, s, n); } catch (x) { }',
  '        _root.inkwell.depth--;',
  '    },',
  '    callRuntime: function(name, arg) {',
  '        if (name == "inkwell.version") return String(_root.inkwell.version);',
  '        if (name == "inkwell.ismenuopen") return "1";',
  '        if (name == "inkwell.isdevmode") return "0";',
  '        _root.inkwell.log("warn", "", "mock callRuntime: unknown name " + name);',
  '        return "";',
  '    },',
  // mock data keys: "setting.<Section>.<Key>" answers Get Setting, "inputDevice" = "gamepad" switches Get Input Device
  '    playSound: function(id) { _root.inkwell.log("info", "", "mock playSound " + id); return id != ""; },',
  '    getSetting: function(section, key, d) { var v = _global.Inkwell.mock["setting." + section + "." + key]; return v == undefined ? d : String(v); },',
  '    getInputDevice: function() { return _global.Inkwell.mock["inputDevice"] == "gamepad" ? "gamepad" : "keyboardMouse"; },',
  // mock data key "tr.<$KEY>" answers translate (the Locale control of the stage toolbar fills them); no entry = the key itself, like the runtime
  '    translate: function(key) { var v = _global.Inkwell.mock["tr." + key]; return v == undefined ? key : String(v); },',
  '    getSaved: function(name, d) { var v = _root.inkwell.saved[name]; return v == undefined ? d : v; }, setSaved: function(name, v) { _root.inkwell.saved[name] = v; },',
  '    watch: function(g, n, sc, v) { }, pin: function(n, p, v) { }',
  '};',
  '_global.Inkwell.paths = {};',
  ...Object.entries(paths).map(([id, p]) => `_global.Inkwell.paths[${JSON.stringify(id)}] = ${JSON.stringify(p)};`), // FFDec's AS2 parser rejects quoted keys in an object literal
  'try {',
  '    flash.external.ExternalInterface.addCallback("inkwellMenuOpen", null, function() { _root.inkwellMenu.onOpen(); return true; });',
  '    flash.external.ExternalInterface.addCallback("inkwellMenuClose", null, function() { _root.inkwellMenu.onClose(); return true; });',
  // what the engine does at every open: a fresh movie, so a new menu class and fresh graphs (menu variables restart); saved values stay in the bridge. Clip texts are not reset (Reload does that)
  '    var reopen = function() {',
  '        _root.inkwellMenu.onClose();',
  // the engine loads a fresh movie, so the root starts untransformed; the new menu class applies the scale again (menu glue, S9)
  '        _root._xscale = 100;',
  '        _root._yscale = 100;',
  '        _root._x = 0;',
  '        _root._y = 0;',
  '        _root.inkwell.reopens++;',
  ...attach.map((l) => `        ${l}`),
  `        _root.inkwellMenu = new ${menuClass}(_root);`,
  '        _root.inkwellMenu.start();',
  '        return true;',
  '    };',
  '    flash.external.ExternalInterface.addCallback("inkwellMenuReopen", null, reopen);',
  // the preview's UI Scale control (S9): `inkwell.uiScale` as the INI would give it, then a reopen so the glue applies it; the answer is the root scale the glue produced (percent)
  '    flash.external.ExternalInterface.addCallback("inkwellUiScale", null, function(scale, offsetX, offsetY) {',
  '        _root.inkwell.uiScale = Number(scale) || 1;',
  '        _root.inkwell.offsetX = Number(offsetX) || 0;',
  '        _root.inkwell.offsetY = Number(offsetY) || 0;',
  '        reopen();',
  '        _root.inkwell.log("info", "", "mock uiScale " + _root.inkwell.uiScale + " -> root scale " + _root._xscale + "% at " + _root._x + "," + _root._y);',
  '        return true;',
  '    });',
  '    flash.external.ExternalInterface.addCallback("inkwellModEvent", null, function(name, strArg, numArg) { _root.inkwellMenu.onModEvent(name, strArg, Number(numArg) || 0); return true; });',
  '    flash.external.ExternalInterface.addCallback("inkwellMessage", null, function(name, text, number, flag) { _root.inkwellMenu.onMessage(name, text, Number(number) || 0, flag == true || flag == "true"); return true; });',
  '    flash.external.ExternalInterface.addCallback("inkwellInput", null, function(action) { _root.inkwellMenu.onInput(action); return true; });',
  // W3 pad emulation (stage keys in Play mode): what the runtime and GFx do for a pad button; Accept presses the focused clip like GFx does in game
  '    flash.external.ExternalInterface.addCallback("inkwellPad", null, function(action) {',
  '        _root.inkwellMenu.onInput(action);',
  '        if (action != "Accept") return true;',
  '        var f = eval(Selection.getFocus());',
  '        if (f.onPress != undefined) f.onPress();',
  '        if (f.onRelease != undefined) f.onRelease();',
  '        return true;',
  '    });',
  '    flash.external.ExternalInterface.addCallback("inkwellClick", null, function(nodeId) {',
  '        var p = _global.Inkwell.paths[nodeId];',
  '        if (p == undefined) return false;',
  '        var o = _root;',
  '        var a = p.split(".");',
  '        for (var k = 0; k < a.length; k++) o = o[a[k]];',
  '        if (typeof (o.onRelease) != "function") return false;',
  '        o.onRelease();',
  '        return true;',
  '    });',
  '} catch (e) {',
  '    trace("[Inkwell] preview menu bridge unavailable: " + e);',
  '}'
]

/** Max image side in px (lint `image-too-large`). */
export const MAX_IMAGE_SIDE = 4096

/** Where a bitmap of iw x ih goes in a w x h box: the drawn rectangle and the bitmap's scale and top-left offset (px). */
export function fitImage(mode: 'fill' | 'fit' | 'tile', iw: number, ih: number, w: number, h: number): { rect: { x: number; y: number; w: number; h: number }; scale: number; tx: number; ty: number; repeat?: boolean } {
  if (mode === 'tile') return { rect: { x: 0, y: 0, w, h }, scale: 1, tx: 0, ty: 0, repeat: true }
  const scale = mode === 'fit' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih)
  const tx = (w - iw * scale) / 2
  const ty = (h - ih * scale) / 2
  return { rect: mode === 'fit' ? { x: tx, y: ty, w: iw * scale, h: ih * scale } : { x: 0, y: 0, w, h }, scale, tx, ty }
}

const pot = (v: number): boolean => v > 0 && (v & (v - 1)) === 0
const num = (n: number): string => String(Math.round(n * 1000) / 1000)

const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('')

export { ident } // shared with the editor UI (default instance names); one definition in shared/overlay.ts

const comment = (s: string): string => s.replace(/[\r\n]+/g, ' ').replace(/\*\//g, '* /')
const lit = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')

interface ScriptItem {
  nodeId: string
  layer: string
  path: string
  script: TextScript
  /** Preview only: the box height in px of a fixed-size text with a verticalAlign; Ruffle ignores the GFx property, so the script moves the field instead. */
  previewBoxH?: number
}

/** The AS2 class that applies GFx text extensions. Tiny, readable, one try/catch per node, errors logged as strings (no Error class in GFx). */
function layoutClass(modId: string, cls: string, swfId: string, items: ScriptItem[]): string {
  const spacing = items.some((i) => i.script.letterSpacing !== undefined)
  const out = [
    `// Generated by Inkwell for SWF "${comment(swfId)}". Do not edit; each block below is tagged with the Figma node id it came from.`,
    `class mods.${modId}.${cls} {`
  ]
  if (spacing) {
    out.push(
      '    static function letterSpacing(t, px) {',
      '        var f = t.getTextFormat();',
      '        f.letterSpacing = px;',
      '        t.setTextFormat(f);',
      '        t.setNewTextFormat(f);',
      '    }',
      ''
    )
  }
  out.push('    static function apply(root) {', '        _global.gfxExtensions = true;')
  for (const it of items) {
    const s = it.script
    out.push(`        // node ${comment(it.nodeId)} "${comment(it.layer)}"`, '        try {', `            var t = ${it.path};`)
    if (s.verticalAlign) out.push(`            t.verticalAlign = "${s.verticalAlign}";`)
    if (s.verticalAlign && it.previewBoxH !== undefined) {
      // shortcut: set once at start, a later Set Text does not re-centre in the preview (the game does); upgrade if the preview needs to follow text changes
      const share = s.verticalAlign === 'center' ? ' / 2' : ''
      out.push(
        `            var free = ${Math.round(it.previewBoxH * 1000) / 1000} - t.textHeight;`,
        `            if (free > 0) { var r = t._rotation * Math.PI / 180; t._x -= (free${share}) * Math.sin(r); t._y += (free${share}) * Math.cos(r); }`
      )
    }
    if (s.textAutoSize) out.push(`            t.textAutoSize = "${s.textAutoSize}";`)
    if (s.letterSpacing !== undefined) out.push(`            mods.${modId}.${cls}.letterSpacing(t, ${Math.round(s.letterSpacing * 1000) / 1000});`)
    out.push('        } catch (e) {', `            trace("[Inkwell] node ${lit(it.nodeId)}: " + e);`, '        }')
  }
  out.push('    }', '}', '')
  return out.join('\n')
}

interface ImageLoad {
  nodeId: string
  layer: string
  path: string
  url: string
  w: number
  h: number
  iw: number
  ih: number
  mode: 'fill' | 'fit'
}

/**
 * dds mode: loads each image into an empty child clip with MovieClipLoader and scales it once loaded (Flash 7 API, within Flash 8 level).
 * Log lines go to trace and, when present, the spike runtime's `_root.inkwellTrace` (Inkwell.log), so an in-game test shows what happened.
 */
function imagesClass(modId: string, cls: string, swfId: string, loads: ImageLoad[]): string {
  const me = `mods.${modId}.${cls}`
  const out = [
    `// Generated by Inkwell for SWF "${comment(swfId)}". Do not edit; each block below is tagged with the Figma node id it came from.`,
    `class ${me} {`,
    '    static function log(s) {',
    '        trace(s);',
    '        if (_root.inkwellTrace != undefined) _root.inkwellTrace(s);',
    '    }',
    '',
    '    // iw/ih: the source size, used when the loaded image reports no size. "fill" crops to the box with a mask.',
    '    static function load(holder, url, w, h, iw, ih, mode, node) {',
    '        var c = holder.createEmptyMovieClip("img", 1);',
    '        if (typeof MovieClipLoader != "function") {',
    `            ${me}.log("[Inkwell] image " + node + ": no MovieClipLoader, loadMovie without sizing " + url);`,
    '            c.loadMovie(url);',
    '            return;',
    '        }',
    '        var l = new MovieClipLoader();',
    '        var o = new Object();',
    '        o.onLoadInit = function(t) {',
    '            try {',
    '                var lw = t._width;',
    '                var lh = t._height;',
    '                if (!(lw > 0) || !(lh > 0)) { lw = iw; lh = ih; }',
    '                var s = mode == "fit" ? Math.min(w / lw, h / lh) : Math.max(w / lw, h / lh);',
    '                t._xscale = s * 100;',
    '                t._yscale = s * 100;',
    '                t._x = (w - lw * s) / 2;',
    '                t._y = (h - lh * s) / 2;',
    '                if (mode == "fill") {',
    '                    var m = holder.createEmptyMovieClip("mask", 2);',
    '                    m.beginFill(0, 100);',
    '                    m.moveTo(0, 0); m.lineTo(w, 0); m.lineTo(w, h); m.lineTo(0, h); m.lineTo(0, 0);',
    '                    m.endFill();',
    '                    t.setMask(m);',
    '                }',
    `                ${me}.log("[Inkwell] image " + node + " loaded " + url + ": reported " + lw + "x" + lh + ", now " + t._width + "x" + t._height);`,
    '            } catch (e) {',
    `                ${me}.log("[Inkwell] image " + node + ": " + e);`,
    '            }',
    '        };',
    `        o.onLoadError = function(t, err) { ${me}.log("[Inkwell] image " + node + " failed to load " + url + ": " + err); };`,
    '        l.addListener(o);',
    '        l.loadClip(url, c);',
    '    }',
    '',
    '    static function apply(root) {'
  ]
  for (const i of loads)
    out.push(
      `        // node ${comment(i.nodeId)} "${comment(i.layer)}"`,
      '        try {',
      `            ${me}.load(${i.path}, "${lit(i.url)}", ${num(i.w)}, ${num(i.h)}, ${i.iw}, ${i.ih}, "${i.mode}", "${lit(i.nodeId)}");`,
      '        } catch (e) {',
      `            ${me}.log("[Inkwell] node ${lit(i.nodeId)}: " + e);`,
      '        }'
    )
  out.push('    }', '}', '')
  return out.join('\n')
}

/** IR -> SWF skeleton tags + SVGs + AS2 sources. Pure: no files, no FFDec. */
export function generate(source: Swf, opts: GenerateOptions): Generated {
  const lint: LintIssue[] = []
  // W4: prompt glyphs are compiled from synthetic layers added to this build's copy of the IR (never saved); their lint is reported on the prompt
  const withGlyphs = source.target.kind === 'customMenu' && !opts.widget && opts.prompts && Object.keys(opts.prompts).length ? withPromptGlyphs(source, opts.prompts) : undefined
  const ir = withGlyphs?.ir ?? source
  if (withGlyphs) lint.push(...withGlyphs.lint)
  const defs: Buffer[] = []
  const shapes: Generated['shapes'] = []
  const embedded = new Map<string, { charId: number; chars: Set<string> }>() // preview: font name -> placeholder DefineFont3
  const custom = new Map<string, { charId: number; family: string; chars: string }>() // embedded custom fonts (V5): asset hash -> placeholder DefineFont3
  const fonts = new Map<string, number>() // alias -> local character id (ImportAssets2)
  const scripts: ScriptItem[] = []
  const fontRows: Generated['fonts'] = []
  let nextId = 1
  const alloc = (): number => nextId++
  const seen = new Set<string>()
  const imageMode: ImageMode = opts.preview ? 'embedded' : (opts.imageMode ?? 'embedded')
  const bitmaps = new Map<string, number>() // hash -> DefineBitsLossless2 id (one per image, shared)
  const loads: ImageLoad[] = []
  const settable: SettableText[] = []
  const keyed: { nodeId: string; here: string; key: string }[] = []
  const layerPaths = new Map<string, string>() // figma node id -> clip path from _root (graph targets)
  const listInfos: ListInfo[] = [] // frames with overlay role `list` (S8)
  // runtime theming (V6.4): a custom menu's bound properties the INI theme changes; a shape is only addressable from AS2 inside a sprite, so those are wrapped
  const tOps = ir.target.kind === 'customMenu' && !opts.widget ? themeOps(ir) : []
  const wrapShape = new Set(tOps.filter((o) => o.target === 'self' && ir.nodes[o.nodeId]?.type === 'shape').map((o) => o.nodeId))
  const wrapFill = new Set(tOps.filter((o) => o.target === 'fill').map((o) => o.nodeId))
  const inSprite = (shapeId: number): number => {
    const sid = alloc()
    defs.push(T.sprite(sid, [T.placeObject2({ depth: 1, charId: shapeId, x: 0, y: 0 })]))
    return sid
  }

  /** One clip (sprite) showing image `hash` in a w x h box; undefined (with lint) when it cannot be drawn. */
  const imageClip = (hash: string, scaleMode: string | undefined, w: number, h: number, nodeId: string, layer: string, path: string): number | undefined => {
    const want = scaleMode ?? 'fill'
    const mode: 'fill' | 'fit' | 'tile' = want === 'fit' ? 'fit' : want === 'tile' && imageMode === 'embedded' ? 'tile' : 'fill'
    if (want === 'crop') lint.push(issue('warning', 'image-scale-mode', nodeId, 'Scale mode CROP is drawn as FILL (the crop rectangle is not applied).'))
    else if (want === 'tile') lint.push(issue('warning', 'image-scale-mode', nodeId, imageMode === 'embedded' ? 'Scale mode TILE repeats the image at its own pixel size (the Figma tile scale is not applied).' : 'Scale mode TILE is drawn as FILL in dds mode.'))
    else if (want !== 'fill' && want !== 'fit') lint.push(issue('warning', 'image-scale-mode', nodeId, `Unknown scale mode "${want}"; drawn as FILL.`))
    const img = isAssetHash(hash) ? opts.images?.(hash) : undefined // the hash becomes a file name (dds) and an asset key
    if (!img) {
      lint.push(issue('error', 'image-missing-asset', nodeId, `Image ${hash.slice(0, 8)} is not in the project's assets (missing or unreadable); it syncs from Figma while the plugin is connected.`))
      return undefined
    }
    if (!(w > 0 && h > 0)) {
      lint.push(issue('info', 'image-empty', nodeId, 'Image box has no size; skipped.'))
      return undefined
    }
    if (Math.max(img.width, img.height) > MAX_IMAGE_SIDE) lint.push(issue('error', 'image-too-large', nodeId, `Image is ${img.width}x${img.height} px; the limit is ${MAX_IMAGE_SIDE} px per side. Scale it down in Figma.`))
    if (imageMode === 'dds' && !(pot(img.width) && pot(img.height))) lint.push(issue('warning', 'image-not-power-of-two', nodeId, `Image is ${img.width}x${img.height} px; DDS textures should be a power of two per side (64, 128, 256...) or the game may not load them.`))
    const id = alloc()
    if (imageMode === 'dds') {
      defs.push(T.sprite(id))
      loads.push({ nodeId, layer, path, url: `img://${ddsRel(opts.modId, hash)}`, w, h, iw: img.width, ih: img.height, mode: mode === 'fit' ? 'fit' : 'fill' })
      return id
    }
    let bid = bitmaps.get(hash)
    if (bid === undefined) {
      bid = alloc()
      bitmaps.set(hash, bid)
      defs.push(T.defineBitsLossless2(bid, img))
    }
    const shapeId = alloc()
    defs.push(T.defineBitmapShape({ id: shapeId, bitmapId: bid, ...fitImage(mode, img.width, img.height, w, h) }))
    defs.push(T.sprite(id, [T.placeObject2({ depth: 1, charId: shapeId, x: 0, y: 0 })]))
    return id
  }

  /**
   * A frame's fills as background clips under its children, bottom fill first: image fills are `imageFill`, `imageFill_2`...; solid fills (and a gradient, drawn as its
   * first stop) are rectangle shapes named `fill`, `fill_2`... The root frame is the stage and stays transparent in game, so its solid and gradient fills are skipped.
   * `skip` depths are left free below the first fill (the clip layer). Placements + their reserved names.
   */
  const background = (n: Extract<Swf['nodes'][string], { type: 'frame' }>, path: string, skip = 0): [Buffer[], string[]] => {
    const bg: Buffer[] = []
    const names: string[] = []
    let images = 0
    let fills = 0
    for (const f of n.fills ?? []) {
      const depth = skip + bg.length + 1
      if (f.type !== 'image') {
        if (n.id === ir.root) {
          lint.push(issue('info', 'frame-fill-root-skipped', n.id, 'The root frame is the stage and is transparent in game; its solid and gradient fills are not drawn. Use a rectangle for a background.'))
          continue
        }
        const svg = rectSvg(n.transform.width, n.transform.height, f, n.id, lint)
        if (!svg) continue
        const name = fills++ ? `fill_${fills}` : 'fill'
        const id = alloc()
        shapes.push({ charId: id, nodeId: n.id, svg })
        defs.push(T.defineShapePlaceholder(id, n.transform.width, n.transform.height))
        names.push(name)
        bg.push(T.placeObject2({ depth, charId: name === 'fill' && wrapFill.has(n.id) ? inSprite(id) : id, name, x: 0, y: 0 }))
        continue
      }
      const name = images++ ? `imageFill_${images}` : 'imageFill'
      const id = imageClip(f.asset, f.scaleMode, n.transform.width, n.transform.height, n.id, n.name, `${path}.${name}`)
      if (id === undefined) continue
      names.push(name)
      bg.push(T.placeObject2({ depth, charId: id, name, x: 0, y: 0, ...(f.opacity !== undefined && f.opacity < 1 ? { alpha: f.opacity } : {}) }))
    }
    return [bg, names]
  }

  const place = (frame: { children: string[] }, path: string, first: Buffer[] = [], reserved: string[] = []): Buffer[] => {
    const out: Buffer[] = [...first]
    const names = new Set<string>(reserved)
    let depth = first.length + 1
    for (const cid of frame.children) {
      const n = ir.nodes[cid]
      if (!n) {
        lint.push(issue('warning', 'node-missing', cid, `Child "${cid}" is not in the node map; skipped.`))
        continue
      }
      if (seen.has(cid)) {
        lint.push(issue('error', 'node-cycle', cid, 'Node appears twice in the tree; skipped.'))
        continue
      }
      seen.add(cid)
      if (!n.visible) {
        lint.push(issue('info', 'node-hidden', cid, 'Hidden node not compiled.'))
        continue
      }
      if (n.type === 'instance' || n.type === 'component') {
        lint.push(issue('warning', 'unsupported-node', cid, `${n.type} nodes are not supported yet; "${n.name}" and its children are skipped.`))
        continue
      }
      if (n.blend && !['normal', 'pass_through'].includes(n.blend.toLowerCase())) // Figma sends upper case (PASS_THROUGH is every layer's default)
        lint.push(issue('warning', 'blend-ignored', cid, `Blend mode "${n.blend}" is not supported; ignored.`))
      if (n.mask) lint.push(issue('warning', 'mask-ignored', cid, 'Masks are not supported yet; ignored.'))

      let name = ident(opts.instanceNames?.[cid] ?? n.name)
      if (opts.instanceNames?.[cid] && names.has(name))
        lint.push(issue('warning', 'instance-name-duplicate', cid, `Instance name "${name}" is already used by a sibling; this one compiles as "${name}_2" or later, so scripts using the name reach the other clip.`))
      for (let i = 2; names.has(name); i++) name = `${ident(opts.instanceNames?.[cid] ?? n.name)}_${i}`
      names.add(name)
      const { x, y, rotation } = n.transform
      const rot = -rotation // Figma rotates counterclockwise, Flash clockwise (unverified in game)
      const base = { depth, name, x, y, ...(rot ? { rotation: rot } : {}), ...(n.opacity < 1 ? { alpha: n.opacity } : {}) }
      const here = `${path}.${name}`
      layerPaths.set(cid, here)

      if (n.type === 'frame') {
        const id = alloc()
        // Clip content: a filled rectangle at depth 1 as a clip layer (PlaceObject2 clipDepth) masks everything above it in this clip, no AS2 needed
        const clip = n.clipContent && n.transform.width > 0 && n.transform.height > 0
        const [bg, reserved] = background(n, here, clip ? 1 : 0)
        const inner = place(n, here, clip ? [Buffer.alloc(0), ...bg] : bg, reserved)
        if (clip) {
          const maskId = alloc()
          shapes.push({ charId: maskId, nodeId: cid, svg: maskSvg(n.transform.width, n.transform.height) })
          defs.push(T.defineShapePlaceholder(maskId, n.transform.width, n.transform.height))
          inner[0] = T.placeObject2({ depth: 1, charId: maskId, x: 0, y: 0, clipDepth: inner.length })
        }
        if (opts.roles?.[cid] === 'list') {
          const l = listInfo(n)
          if (l) listInfos.push(l)
        }
        defs.push(T.sprite(id, inner))
        out.push(T.placeObject2({ ...base, charId: id }))
      } else if (n.type === 'image') {
        const id = imageClip(n.asset, n.scaleMode, n.transform.width, n.transform.height, cid, n.name, here)
        if (id === undefined) continue
        const alpha = n.opacity * (n.fillOpacity ?? 1)
        const { alpha: _nodeAlpha, ...at } = base
        out.push(T.placeObject2({ ...at, charId: id, ...(alpha < 1 ? { alpha } : {}) }))
      } else if (n.type === 'shape') {
        const r = shapeToSvg(n)
        lint.push(...r.lint)
        if (!r.svg) continue
        const id = alloc()
        shapes.push({ charId: id, nodeId: cid, svg: r.svg })
        defs.push(T.defineShapePlaceholder(id, n.transform.width, n.transform.height))
        out.push(T.placeObject2({ ...base, charId: wrapShape.has(cid) ? inSprite(id) : id }))
      } else {
        const hash = opts.embeddedFonts?.byNode[cid]
        const face = hash ? opts.embeddedFonts?.fonts[hash] : undefined
        if (hash && !face) lint.push(issue('error', 'font-file-missing', cid, `The embedded font ${hash.slice(0, 8)} of "${n.name}" is not in the project (fonts/${hash}.ttf). Choose another font or add the file again.`))
        const m = mapText(n, opts.glyphs, face ? { family: face.family, ...(face.lineHeight ? { lineHeight: face.lineHeight } : {}) } : undefined)
        lint.push(...m.lint)
        if (m.font) fontRows.push({ ...m.font, nodeId: cid, nodeName: n.name })
        if (!m.text) continue
        let fontId = 0
        let fontClass: string | undefined
        if (m.text.embedded && hash && face) {
          let c = custom.get(hash)
          if (!c) {
            c = { charId: alloc(), family: face.family, chars: face.chars }
            custom.set(hash, c)
            defs.push(T.defineFont3Placeholder(c.charId, face.family))
          }
          fontId = c.charId
        } else if (!opts.preview) {
          fontId = fonts.get(m.text.alias) ?? alloc()
          fonts.set(m.text.alias, fontId)
        } else {
          const fname = (opts.previewFont ?? previewDeviceFont)(m.text.alias)
          if (opts.previewFontBytes?.(fname)) {
            let e = embedded.get(fname)
            if (!e) {
              e = { charId: alloc(), chars: new Set(ASCII) }
              embedded.set(fname, e)
              defs.push(T.defineFont3Placeholder(e.charId, fname))
            }
            for (const c of m.text.field.text) if (c !== '\r') e.chars.add(c)
            fontId = e.charId
          } else fontClass = fname
        }
        const id = alloc()
        defs.push(T.defineEditText({ ...m.text.field, id, fontId, ...(fontClass ? { fontClass } : {}) }))
        // the gutter offset is in the node's own (possibly rotated) space
        const r = (rot * Math.PI) / 180
        const { x: gx, y: gy } = m.text.gutter
        out.push(T.placeObject2({ ...base, charId: id, x: x + gx * Math.cos(r) - gy * Math.sin(r), y: y + gx * Math.sin(r) + gy * Math.cos(r) }))
        if (opts.locKeys?.[cid]) keyed.push({ nodeId: cid, here, key: opts.locKeys[cid]! })
        if (Object.keys(m.text.script).length) scripts.push({ nodeId: cid, layer: n.name, path: here, script: m.text.script, ...(opts.preview && n.sizing === 'fixed' && m.text.script.verticalAlign ? { previewBoxH: n.transform.height } : {}) })
        if (opts.widget && !opts.preview && opts.settableTexts?.has(cid) && here.startsWith('root.widget.')) {
          // Papyrus is case-insensitive: the instance name becomes a parameter name, so it must be unique ignoring case
          if (settable.some((t) => t.name.toLowerCase() === name.toLowerCase()))
            lint.push(issue('error', 'widget-text-name-clash', cid, `Another settable text is already named "${name}" (Papyrus ignores case). Give this layer a different instance name.`))
          else settable.push({ nodeId: cid, layer: n.name, name, path: here.slice('root.widget.'.length) })
        }
      }
      depth++
    }
    return out
  }

  /** The list component of frame `n` (already placed): item template, its text layers, geometry. Lint and undefined when it cannot work. */
  const listInfo = (n: Extract<Swf['nodes'][string], { type: 'frame' }>): ListInfo | undefined => {
    const cfg = opts.lists?.[n.id]
    if (cfg?.itemTemplate && !n.children.includes(cfg.itemTemplate)) lint.push(issue('warning', 'list-template-invalid', n.id, `The item template ${cfg.itemTemplate} is not a child of the list "${n.name}"; the first child is used.`))
    const tid = cfg?.itemTemplate && n.children.includes(cfg.itemTemplate) ? cfg.itemTemplate : n.children[0]
    const t = tid ? ir.nodes[tid] : undefined
    const tp = tid ? layerPaths.get(tid) : undefined
    if (!t || t.type !== 'frame' || !tp) {
      lint.push(issue('error', 'list-template-invalid', n.id, `The list "${n.name}" needs a visible frame as its item template (the first child, or the layer set in its list settings); it is not a list without one.`))
      return undefined
    }
    const fields: ListInfo['fields'] = []
    const walk = (id: string): void => {
      for (const c of ir.nodes[id]?.children ?? []) {
        const cn = ir.nodes[c]
        const cp = layerPaths.get(c)
        if (!cn || !cp) continue
        if (cn.type === 'text') fields.push({ name: cp.slice(cp.lastIndexOf('.') + 1), path: cp.slice(tp.length + 1) })
        else if (cn.type === 'frame') walk(c)
      }
    }
    walk(tid!)
    if (!fields.length) lint.push(issue('warning', 'list-template-no-text', t.id, `The item template "${t.name}" of the list "${n.name}" has no text layer, so rows show no item text.`))
    const here = layerPaths.get(n.id)!
    return { path: here.slice('root.'.length), template: tp.slice(tp.lastIndexOf('.') + 1), w: n.transform.width, h: n.transform.height, tx: t.transform.x, ty: t.transform.y, tw: t.transform.width, th: t.transform.height, spacing: cfg?.spacing ?? 0, fields }
  }

  const root = ir.nodes[ir.root]
  let mainPlaces: Buffer[] = []
  let stage = ir.stage
  const widget = opts.widget && !opts.preview
  const wf = widget ? widgetFrame(ir) : undefined
  if (widget && wf) {
    // the widget frame's children live in the clip `widget`; its position/anchor go to the Papyrus script, not the SWF
    seen.add(ir.root)
    seen.add(wf.frame.id)
    const id = alloc()
    defs.push(T.sprite(id, place(wf.frame, 'root.widget', ...background(wf.frame, 'root.widget'))))
    mainPlaces = [T.placeObject2({ depth: 1, charId: id, name: 'widget', x: 0, y: 0, scale: HUD_SCALE })]
    stage = { width: Math.round(ir.stage.width * HUD_SCALE), height: Math.round(ir.stage.height * HUD_SCALE) }
    if (!wf.isRoot)
      for (const cid of root!.type === 'frame' ? root!.children : [])
        if (!seen.has(cid)) lint.push(issue('warning', 'widget-extra-content', cid, 'Only the first frame is the widget; this top-level layer is not compiled.'))
  } else if (root?.type === 'frame') {
    seen.add(ir.root)
    mainPlaces = place(root, 'root', ...background(root, 'root'))
  } else {
    lint.push(issue('error', 'root-invalid', ir.root, 'The root node is missing or not a frame; nothing compiled.'))
  }
  if (root?.type === 'frame') lint.push(...offStage(ir))

  const mod = ident(opts.modId)
  const swfCls = ident(ir.id).replace(/^_?([a-z])/, (_, c: string) => c.toUpperCase())
  const as2: Generated['as2'] = []
  const extra: Buffer[] = []
  const frameCode: string[] = []
  const addClass = (cls: string, source: string): void => {
    const classId = alloc()
    extra.push(T.sprite(classId), T.exportAssets([{ id: classId, name: `__Packages.mods.${mod}.${cls}` }]), T.doInitAction(classId))
    as2.push({ path: `__Packages/mods/${mod}/${cls}.as`, source })
  }
  // graphs: the widget's behaviour comes from On Widget Call (no hardcoded popup API); a graph is a class instantiated on the base clip
  const menu = ir.target.kind === 'customMenu' && !opts.widget // S7: a custom menu gets the glue class; `widget` is the HUD flavour and wins if both are asked for
  const baseExpr = widget && wf ? 'widget' : 'this'
  const basePrefix = widget && wf ? 'root.widget.' : 'root.'
  const gen = opts.graphs?.graphs.length
    ? generateGraphClasses({
        modId: mod, swfCls, graphs: opts.graphs.graphs, packs: opts.graphs.packs, ...(opts.bindings ? { bindings: opts.bindings } : {}), ...(opts.preview ? { preview: true } : {}), ...(menu ? { menu: true } : {}), ...(menu && opts.dev && !opts.preview ? { dev: true } : {}),
        layerPath: (id) => (id === (widget && wf ? wf.frame.id : ir.root) ? '' : layerPaths.get(id)?.startsWith(basePrefix) ? layerPaths.get(id)!.slice(basePrefix.length) : undefined)
      })
    : undefined
  const graphCalls = gen?.classes.flatMap((c) => c.calls) ?? []
  const graphDriven = graphCalls.length > 0
  for (const x of gen?.issues ?? []) lint.push(issue('error', x.code, ir.root, `Graph "${x.graphId}"${x.nodeId ? ` node ${x.nodeId}` : ''}: ${x.message}`))
  if (widget && wf) {
    addClass(`${swfCls}Widget`, widgetContractClass(mod, `${swfCls}Widget`, graphDriven ? [] : settable))
    frameCode.push(`mods.${mod}.${swfCls}Widget.install(widget);`)
  }
  if (scripts.length) {
    addClass(`${swfCls}Layout`, layoutClass(mod, `${swfCls}Layout`, ir.id, scripts))
    frameCode.push(`mods.${mod}.${swfCls}Layout.apply(this);`)
  }
  if (loads.length) {
    addClass(`${swfCls}Images`, imagesClass(mod, `${swfCls}Images`, ir.id, loads))
    frameCode.push(`mods.${mod}.${swfCls}Images.apply(this);`)
  }
  // Ruffle has no SKSE or SkyUI: stub what Skyrim provides. Only what generated code touches today (gfxExtensions is also set by the layout class).
  if (opts.preview)
    frameCode.unshift(
      '_global.gfxExtensions = true;',
      'if (_global.skse == undefined) _global.skse = { plugins: {}, SendModEvent: function() {}, GetPluginVersion: function() { return 0; } };',
      'if (_global.Inkwell == undefined) _global.Inkwell = { bridge: { send: function() {}, on: function() {} } };',
      ...PREVIEW_BRIDGE
    )
  if (listInfos.length) {
    addClass('InkwellList', listClassSource(mod))
    frameCode.push(...listInfos.map((l) => listAttachCode(mod, l)))
  }
  // W5: the engine glue of a menu replacement, installed before the graphs register their contract-node handlers
  const glue = ir.target.kind === 'menuReplacement' && opts.contract && !opts.widget ? replacementGlue(opts.contract, mod, swfCls, opts.preview === true) : undefined
  if (glue) {
    addClass(replacementClassName(swfCls), glue.source)
    frameCode.push(...replacementFrameCode(mod, swfCls))
  }
  gen?.classes.forEach((c, k) => {
    addClass(c.cls, c.source)
    if (!menu) frameCode.push(`${baseExpr}.inkwellGraph${k} = new mods.${mod}.${c.cls}(${baseExpr});`, `${baseExpr}.inkwellGraph${k}.init();`)
  })
  const translatedTexts = menu ? keyed.flatMap((k) => (k.here.startsWith('root.') ? [{ nodeId: k.nodeId, path: k.here.slice('root.'.length), key: k.key }] : [])) : []
  if (menu) {
    // the menu class creates and init()s the graphs once the runtime bridge is ready (S7); the runtime waits for its glueReady()
    const pathOf = (id: string): string | undefined => (layerPaths.get(id)?.startsWith('root.') ? layerPaths.get(id)!.slice('root.'.length) : undefined)
    const themed = tOps.flatMap((o) => { const p = pathOf(o.nodeId); return p ? [{ path: o.target === 'fill' ? `${p}.fill` : p, kind: o.kind, values: o.values }] : [] })
    const byRole = (...r: string[]): string[] => Object.entries(opts.roles ?? {}).filter(([, role]) => r.includes(role)).flatMap(([id]) => pathOf(id) ?? [])
    // W3: the focus graph by clip path; a member that was not compiled (hidden) is left out and moves to it stay put
    const fOrder = (opts.focus?.order ?? []).filter((id) => pathOf(id) !== undefined)
    for (const id of opts.focus?.order ?? []) if (pathOf(id) === undefined) lint.push(issue('warning', 'focus-not-compiled', id, 'This focusable layer is not compiled (hidden?), so the focus graph skips it.'))
    const focusGlue = fOrder.length ? { paths: fOrder.map((id) => pathOf(id)!), moves: fOrder.map((id, k) => FOCUS_DIRS.map((d) => { const t = fOrder.indexOf(opts.focus!.moves[id]?.[d] ?? id); return t < 0 ? k : t })) } : undefined
    const promptGlue = Object.keys(opts.prompts ?? {}).flatMap((pid) => {
      const ps = PROMPT_DEVICE_ORDER.map((d) => (opts.prompts![pid]![d] ? pathOf(glyphId(pid, d)) ?? null : null))
      return ps.some((x) => x) ? [ps] : []
    })
    addClass(menuClassName(swfCls), menuClassSource({ modId: mod, swfCls, graphs: gen?.classes.map((c) => ({ cls: c.cls, id: c.graphId })) ?? [], focusable: byRole('button', 'list').sort(), ...(focusGlue ? { focus: focusGlue } : {}), ...(promptGlue.length ? { prompts: promptGlue } : {}), ...(themed.length ? { themed: { themes: themeModes(ir), ops: themed } } : {}), ...(translatedTexts.length ? { translated: translatedTexts.map((t) => ({ path: t.path, key: t.key })) } : {}), ...(listInfos.length ? { listClass: listClassName(mod) } : {}), ...(menu && opts.dev && !opts.preview ? { dev: true } : {}) }))
    if (opts.preview) {
      const paths = Object.fromEntries(Object.entries(opts.roles ?? {}).filter(([, role]) => role === 'button').flatMap(([id]) => (pathOf(id) !== undefined ? [[id, pathOf(id)!]] : [])))
      frameCode.push(...previewMenuBridge(`${mod}_${swfCls}`, `mods.${mod}.${menuClassName(swfCls)}`, paths, listInfos.map((l) => listAttachCode(mod, l, '_root'))))
    }
    frameCode.push(...menuFrameCode(mod, swfCls))
  }
  if (frameCode.length) as2.push({ path: 'frame_1/DoAction.as', source: ['// Generated by Inkwell: runs once the clips exist.', ...frameCode, ''].join('\n') })

  const tags = [
    T.setBackgroundColor(0, 0, 0),
    ...[...fonts].map(([name, id]) => T.importAssets2('gfxfontlib.swf', { id, name })),
    ...defs,
    ...extra,
    ...mainPlaces,
    ...(frameCode.length ? [T.doAction()] : []),
    T.showFrame(),
    T.endTag()
  ]
  const embeddedFonts = [
    ...[...embedded].map(([name, e]) => ({ charId: e.charId, name, chars: [...e.chars].join('') })),
    ...[...custom].map(([hash, c]) => ({ charId: c.charId, name: c.family, chars: c.chars, hash }))
  ]
  // synthetic glyph layers: their findings belong to the prompt, their font rows are not the author's text
  const lintOut = withGlyphs ? lint.map((l) => (isGlyphNode(l.nodeId) ? { ...l, nodeId: glyphOwner(l.nodeId), ...(l.nodeName !== undefined ? { nodeName: ir.nodes[glyphOwner(l.nodeId)]?.name ?? l.nodeName } : {}) } : l)) : lint
  return { tags, shapes, as2, lint: lintOut, fonts: withGlyphs ? fontRows.filter((f) => !isGlyphNode(f.nodeId)) : fontRows, stage, embeddedFonts, gfxTextExtensions: scripts.length, ddsImages: loads.length, settableTexts: settable, translatedTexts, graphClasses: gen?.classes ?? [], graphCalls, layerPaths: Object.fromEntries(layerPaths), contractProvided: glue?.provided ?? {} }
}

/** `node-off-stage`: a visible layer whose box lies entirely outside the frame (the stage), so it never shows. One warning per subtree. */
export function offStage(ir: Swf): LintIssue[] {
  const out: LintIssue[] = []
  const seen = new Set<string>()
  const walk = (id: string, ox: number, oy: number): void => {
    for (const cid of ir.nodes[id]?.children ?? []) {
      const n = ir.nodes[cid]
      if (!n || !n.visible || seen.has(cid)) continue
      seen.add(cid)
      const { x, y, width, height, rotation } = n.transform
      const ax = ox + x
      const ay = oy + y
      // shortcut: rotated layers are not checked (their box is not axis-aligned); add corner math if rotated off-stage layers turn up
      if (!rotation && (ax + width <= 0 || ay + height <= 0 || ax >= ir.stage.width || ay >= ir.stage.height)) {
        out.push(issue('warning', 'node-off-stage', cid, `"${n.name}" is outside the ${ir.stage.width}x${ir.stage.height} frame and will not be visible.`))
        continue
      }
      if (!rotation) walk(cid, ax, ay)
    }
  }
  walk(ir.root, 0, 0)
  return out
}
