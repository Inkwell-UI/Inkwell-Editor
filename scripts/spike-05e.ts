// yarn spike:05e [--to <mods\name>] [--dll <Inkwell.dll>] -> the 0.5 Phase 1 spike S-E (PLAN-0.5): prompt glyphs and the active input device.
// Builds ONE test menu SWF (live input device line + 5 candidate button-art loads, all logged to Inkwell.log) with the editor's tag writer + FFDec, plus the menu JSON and the runtime DLL,
// into one MO2 mod folder (default "Inkwell Spike 05E"). Nothing here is product code. Never the game's Data folder, never another mod's folder. Needs Java, FFDec and the wrapper jar.
// The device comes from the runtime bridge: _root.inkwell.getInputDevice() returns "gamepad" or "keyboardMouse" = the device of the LAST input event the runtime's input sink saw (Inkwell-Runtime Input.cpp).
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { createFfdecWrapper } from '../src/main/build/ffdecWrapper'
import * as T from '../src/main/swf/tags'

const root = resolve(__dirname, '..')
const arg = (k: string): string | undefined => {
  const i = process.argv.indexOf(k)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const MOD = 'InkwellSpike05E'
const MENU = `${MOD}_Menu`
const dest = resolve(arg('--to') ?? 'C:\\Modding\\MO2\\mods\\Inkwell Spike 05E')
if (!/[\\/]mods[\\/][^\\/]+$/i.test(dest) || /[\\/]data([\\/]|$)/i.test(dest)) throw new Error(`Refusing ${dest}: it must be one MO2 mod folder (...\\mods\\<name>).`)
const dll = resolve(arg('--dll') ?? process.env['INKWELL_RUNTIME_DLL'] ?? 'D:/Mods/Inkwell/Inkwell-Runtime/build/Release/Inkwell.dll')
if (!existsSync(dll)) throw new Error(`Runtime DLL not found: ${dll}`)

// Candidate art, round 2 (S-F, 2026-10-28): the real names in Skyrim - Interface.bsa are interface/exported/360_a.png.dds, ps3_a.png.dds, 360_start.png.dds, ... (round 1 guessed Controls/ paths and drew nothing). Relative paths are relative to this menu's SWF (Interface/Inkwell/<mod>/Menu.swf);
// img:// paths are relative to Data (the editor's DDS image mode uses img://textures/...; images.md).
const CANDIDATES = [
  'img://Interface/exported/360_a.png.dds',
  'img://Interface/exported/360_a.png',
  'img://exported/360_a.png.dds',
  'img://Interface/exported/ps3_a.png.dds',
  'img://Interface/exported/360_start.png.dds'
]

const white = { r: 255, g: 255, b: 255, a: 255 }
const FONT_ALIAS = 1
interface Field { name: string; x: number; y: number; w: number; h: number; size: number; text: string; multiline?: boolean }
const F: Field[] = [
  { name: 'title', x: 80, y: 60, w: 1700, h: 44, size: 32, text: 'S-E  prompt glyphs and active input device' },
  { name: 'help', x: 80, y: 110, w: 1700, h: 80, size: 24, text: 'Move the mouse, press keys, then use the pad (sticks, buttons) and watch the device line. Log lines: [spike05e].', multiline: true },
  { name: 'devTxt', x: 80, y: 200, w: 1700, h: 70, size: 48, text: 'device: ...' },
  { name: 'devlog', x: 80, y: 280, w: 1700, h: 150, size: 22, text: '', multiline: true },
  { name: 'lastKey', x: 80, y: 440, w: 1700, h: 40, size: 24, text: 'last key: none' },
  ...CANDIDATES.map((c, i) => ({ name: `s${i + 1}`, x: 280, y: 520 + i * 90, w: 1500, h: 80, size: 22, text: `${i + 1}: ${c}  ...`, multiline: true }))
]

const tags: Buffer[] = [T.setBackgroundColor(0, 0, 0)]
tags.push(T.importAssets2('gfxfontlib.swf', { id: FONT_ALIAS, name: '$EverywhereMediumFont' }))
let nextId = 10
const panelId = nextId++
tags.push(T.defineShapePlaceholder(panelId, 1840, 1000))
let depth = 1
tags.push(T.placeObject2({ depth: depth++, charId: panelId, x: 40, y: 40 }))
for (const f of F) {
  const id = nextId++
  tags.push(T.defineEditText({ id, wPx: f.w, hPx: f.h, fontId: FONT_ALIAS, sizePx: f.size, color: white, text: f.text, wordWrap: !!f.multiline, multiline: !!f.multiline, autoSize: false, align: 0, leadingPx: 0 }))
  tags.push(T.placeObject2({ depth: depth++, charId: id, name: f.name, x: f.x, y: f.y }))
}
// S-G (2026-10-28): the game's button bitmaps are exported by Interface/hudmenu.swf (360_A.png, PS3_A.png, Enter.png, ...; found with FFDec, not shipped). Import them like a font from gfxfontlib.swf:
// one ImportAssets2 per asset, then a shape filled with the imported bitmap. Left group: url 'hudmenu.swf' (like gfxfontlib.swf); right group: '../../hudmenu.swf' (relative to this SWF).
const IMPORTS: { url: string; name: string }[] = [
  ...['360_A.png', '360_B.png', 'PS3_A.png', 'Enter.png'].map((name) => ({ url: 'hudmenu.swf', name })),
  ...['360_A.png', '360_B.png', 'PS3_A.png', 'Enter.png'].map((name) => ({ url: '../../hudmenu.swf', name }))
]
// --imports a|b|both builds only that group (a failed ImportAssets2 can make the whole SWF fail to load: 2026-10-28 the first 'both' build did not load); default: none (the S-F menu)
const SEL = arg('--imports')
const USED = IMPORTS.map((im, i) => ({ im, i })).filter(({ i }) => (SEL === 'a' ? i < 4 : SEL === 'b' ? i >= 4 : SEL === 'both'))
USED.forEach(({ im, i }) => {
  const bid = nextId++
  const sid = nextId++
  const lid = nextId++
  const x = 1000 + (i % 4) * 190
  const y = 540 + Math.floor(i / 4) * 200
  tags.push(T.importAssets2(im.url, { id: bid, name: im.name }))
  tags.push(T.defineBitmapShape({ id: sid, bitmapId: bid, rect: { x: 0, y: 0, w: 64, h: 64 }, scale: 1, tx: 0, ty: 0 }))
  tags.push(T.placeObject2({ depth: depth++, charId: sid, x, y }))
  tags.push(T.defineEditText({ id: lid, wPx: 180, hPx: 60, fontId: FONT_ALIAS, sizePx: 16, color: white, text: `${i < 4 ? 'hudmenu.swf' : '../../hudmenu.swf'}
${im.name}`, wordWrap: true, multiline: true, autoSize: false, align: 0, leadingPx: 0 }))
  tags.push(T.placeObject2({ depth: depth++, charId: lid, x, y: y + 70 }))
})
tags.push(T.doAction(), T.showFrame(), T.endTag())

const as2 = `// Spike 05 S-E (not product code).
_global.gfxExtensions = true;
var CANDS = [${CANDIDATES.map((c) => `"${c}"`).join(', ')}];
var seq = 0;
var LOADERS = new Array();
var glued = false;
var started = false;
var frames = 0;
var prevDev = "";
var devHist = new Array();
function say(s) {
  if (typeof(_root.inkwell.log) == "function") { _root.inkwell.log("info", "", "[spike05e] " + s); }
  else if (_root.inkwellTrace) { _root.inkwellTrace("[spike05e] " + s); }
}
function dev() { return (typeof(_root.inkwell.getInputDevice) == "function") ? _root.inkwell.getInputDevice() : "n/a (no getInputDevice)"; }
function dump(o) { var s = ""; for (var k in o) { s += k + "=" + o[k] + " "; } return s; }
function setStatus(i, text) {
  _root["s" + (i + 1)].text = (i + 1) + ": " + CANDS[i] + String.fromCharCode(13) + text;
  say("candidate " + (i + 1) + " " + CANDS[i] + " -> " + text);
}
function loadAll() {
  for (var i = 0; i < CANDS.length; i++) {
    var holder = _root.createEmptyMovieClip("g" + (i + 1), 100 + i);
    holder._x = 100;
    holder._y = 520 + i * 90;
    holder.idx = i;
    var l = new MovieClipLoader();
    l.idx = i;
    l.holder = holder;
    l.onLoadStart = function(mc) { say("candidate " + (this.idx + 1) + " onLoadStart"); };
    l.onLoadError = function(mc, code) { setStatus(this.idx, "FAIL onLoadError " + code); };
    l.onLoadInit = function(mc) {
      var kids = "";
      for (var k in mc) { if (typeof(mc[k]) == "movieclip") { kids += k + " "; } }
      setStatus(this.idx, "OK onLoadInit w=" + mc._width + " h=" + mc._height + " frames=" + mc._totalframes + " children: " + kids);
      if (mc._width > 128) { mc._xscale = 12800 / mc._width; mc._yscale = mc._xscale; }
      this.done = true;
    };
    var r = l.loadClip(CANDS[i], holder);
    say("candidate " + (i + 1) + " loadClip returned " + r);
    LOADERS[i] = l; // keep the loader alive
  }
  // after 5 s anything without a verdict is reported
  _root.timeoutAt = frames + 150;
}
var kl = new Object();
kl.onKeyDown = function() { lastKey.text = "last key: code=" + Key.getCode() + " ascii=" + Key.getAscii() + "  device=" + dev(); say("Key.onKeyDown code=" + Key.getCode() + " device=" + dev()); };
Key.addListener(kl);
_root.inkwellMenu = {
  onOpen: function() {
    say("onOpen device=" + dev());
    say("bridge members: " + dump(_root.inkwell));
    if (!started) { started = true; loadAll(); }
  },
  onClose: function() { say("onClose"); },
  onInput: function(a) { say("onInput action=" + a + " device=" + dev()); },
  onMessage: function() {},
  onModEvent: function() {}
};
_root.onEnterFrame = function() {
  frames++;
  if (!glued && _root.inkwell.ready == true && typeof(_root.inkwell.glueReady) == "function") { glued = true; _root.inkwell.glueReady(); }
  var d = dev();
  if (d != prevDev) {
    var line = "frame " + frames + ": " + (prevDev == "" ? "(start)" : prevDev) + " -> " + d;
    devHist.push(line);
    if (devHist.length > 6) { devHist.shift(); }
    devlog.text = devHist.join(String.fromCharCode(13));
    say("device changed: " + line);
    prevDev = d;
  }
  dev_text();
  if (_root.timeoutAt > 0 && frames == _root.timeoutAt) {
    for (var i = 0; i < 5; i++) {
      var l = LOADERS[i];
      if (l.done != true && _root["s" + (i + 1)].text.indexOf("FAIL") < 0) { setStatus(i, "NO VERDICT after 5 s (neither onLoadInit nor onLoadError)"); }
    }
  }
};
function dev_text() { _root.devTxt.text = "device: " + prevDev; }
`

async function main(): Promise<void> {
  const ffdec = createFfdecWrapper({
    javaPath: process.env['INKWELL_JAVA'] ?? 'java',
    ffdecDir: process.env['INKWELL_FFDEC'] ?? 'C:\\Program Files (x86)\\FFDec',
    jarPath: resolve(root, 'tools/ffdec-wrapper/build/ffdec-wrapper.jar')
  })
  try {
    const dir = mkdtempSync(resolve(tmpdir(), 'inkwell-spike05e-'))
    const w = (rel: string, data: string | Buffer): void => { mkdirSync(dirname(resolve(dir, rel)), { recursive: true }); writeFileSync(resolve(dir, rel), data) }
    w('base.swf', T.writeSwf({ widthPx: 1920, heightPx: 1080, tags }))
    w(`shapes/${panelId}.svg`, '<svg xmlns="http://www.w3.org/2000/svg" width="1840" height="1000" viewBox="0 0 1840 1000"><rect width="1840" height="1000" fill="#101418" fill-opacity="0.92"/></svg>')
    w('as2/frame_1/DoAction.as', as2)
    const out = resolve(dest, 'Interface', 'Inkwell', MOD, 'Menu.swf')
    mkdirSync(dirname(out), { recursive: true })
    const r = await ffdec.build({ base: resolve(dir, 'base.swf'), shapes: resolve(dir, 'shapes'), scripts: resolve(dir, 'as2'), out })
    if (!r.ok) throw new Error(`FFDec build failed: ${r.error ?? 'unknown'}`)
    console.log(`wrote ${out} (${readFileSync(out).length} bytes, ffdec ${r.ms.toFixed(0)} ms)`)
  } finally {
    ffdec.stop()
  }

  const menu = {
    depth: 3, flags: { closeOnEscape: true, cursor: true, modal: true, pausesGame: true }, inputContext: 'menuMode', minRuntime: '0.4.0',
    name: MENU, specVersion: 7, swf: `Interface/Inkwell/${MOD}/Menu.swf`, triggers: { hotkey: 68, modEvent: `${MOD}_Open`, papyrus: true }
  }
  const mj = resolve(dest, 'SKSE', 'Plugins', 'Inkwell', 'menus', `${MENU}.json`)
  mkdirSync(dirname(mj), { recursive: true })
  writeFileSync(mj, JSON.stringify(menu, null, 2) + '\n')

  const outDll = resolve(dest, 'SKSE', 'Plugins', 'Inkwell.dll')
  mkdirSync(dirname(outDll), { recursive: true })
  copyFileSync(dll, outDll)
  console.log(`deployed spike 05E to ${dest} (menu ${MENU}, hotkey F10)`)
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 })
