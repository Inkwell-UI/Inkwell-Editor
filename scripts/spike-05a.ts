// yarn spike:05a [--context menuMode|none|absent] [--manual] [--to <mods\name>] [--dll <Inkwell.dll>] -> the 0.5 Phase 1 spike S-A (PLAN-0.5): gamepad focus in a custom menu.
// Builds ONE test menu SWF (4 buttons + event log, AS2 logs every key/handleInput/onInput/focus event to Inkwell.log) with the editor's tag writer + FFDec, plus the menu JSON and the runtime DLL,
// into one MO2 mod folder (default "Inkwell Spike 05A"). Nothing here is product code. Never the game's Data folder, never another mod's folder. Needs Java, FFDec and the wrapper jar.
// --context sets the menu JSON "inputContext" (the runtime accepts only "none" and "menuMode"; "absent" leaves it out: menuMode because modal). You can also edit the deployed JSON by hand.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { createFfdecWrapper } from '../src/main/build/ffdecWrapper'
import * as T from '../src/main/swf/tags'

const root = resolve(__dirname, '..')
const arg = (k: string): string | undefined => {
  const i = process.argv.indexOf(k)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const MOD = 'InkwellSpike05A'
const MENU = `${MOD}_Menu`
const dest = resolve(arg('--to') ?? 'C:\\Modding\\MO2\\mods\\Inkwell Spike 05A')
if (!/[\\/]mods[\\/][^\\/]+$/i.test(dest) || /[\\/]data([\\/]|$)/i.test(dest)) throw new Error(`Refusing ${dest}: it must be one MO2 mod folder (...\\mods\\<name>).`)
const dll = resolve(arg('--dll') ?? process.env['INKWELL_RUNTIME_DLL'] ?? 'D:/Mods/Inkwell/Inkwell-Runtime/build/Release/Inkwell.dll')
if (!existsSync(dll)) throw new Error(`Runtime DLL not found: ${dll}`)
const ctx = arg('--context') ?? 'menuMode'
if (!['menuMode', 'none', 'absent'].includes(ctx)) throw new Error(`--context must be menuMode, none or absent, got ${ctx}`)
const manual = process.argv.includes('--manual')

const white = { r: 255, g: 255, b: 255, a: 255 }
const FONT_ALIAS = 1
interface Field { name: string; x: number; y: number; w: number; h: number; size: number; text: string; multiline?: boolean }
const BTN = { w: 420, h: 140 }
const btnPos = [{ x: 200, y: 400 }, { x: 700, y: 400 }, { x: 200, y: 580 }, { x: 700, y: 580 }]
const F: Field[] = [
  { name: 'title', x: 80, y: 60, w: 1700, h: 44, size: 32, text: `S-A  gamepad focus   inputContext=${ctx}   manual nav at start=${manual}` },
  { name: 'help', x: 80, y: 110, w: 1700, h: 80, size: 24, text: 'Press d-pad / stick / A / B and keys 1-4 (setFocus), 5 (setFocus by string), M (toggle manual nav). Button 4 click/A also toggles manual nav.', multiline: true },
  ...btnPos.map((p, i) => ({ name: `l${i + 1}`, x: p.x + 20, y: p.y + 45, w: BTN.w - 40, h: 40, size: 28, text: i === 3 ? 'Button 4 (toggle manual)' : `Button ${i + 1}` })),
  { name: 'state', x: 80, y: 220, w: 1700, h: 40, size: 26, text: 'state: waiting for AS2' },
  { name: 'last', x: 80, y: 280, w: 1700, h: 100, size: 26, text: 'last event: none yet', multiline: true },
  { name: 'histTxt', x: 80, y: 760, w: 1700, h: 260, size: 22, text: '', multiline: true }
]

const tags: Buffer[] = [T.setBackgroundColor(0, 0, 0)]
tags.push(T.importAssets2('gfxfontlib.swf', { id: FONT_ALIAS, name: '$EverywhereMediumFont' }))
let nextId = 10
const panelId = nextId++
const btnShapeId = nextId++
const btnClipIds = btnPos.map(() => nextId++)
tags.push(T.defineShapePlaceholder(panelId, 1840, 1000), T.defineShapePlaceholder(btnShapeId, BTN.w, BTN.h))
for (const id of btnClipIds) tags.push(T.sprite(id, [T.placeObject2({ depth: 1, charId: btnShapeId, x: 0, y: 0 })])) // a shape has no _x/_width/focus in AS2: it needs a sprite
let depth = 1
tags.push(T.placeObject2({ depth: depth++, charId: panelId, x: 40, y: 40 }))
btnPos.forEach((p, i) => tags.push(T.placeObject2({ depth: depth++, charId: btnClipIds[i]!, name: `b${i + 1}`, x: p.x, y: p.y })))
for (const f of F) {
  const id = nextId++
  tags.push(T.defineEditText({ id, wPx: f.w, hPx: f.h, fontId: FONT_ALIAS, sizePx: f.size, color: white, text: f.text, wordWrap: !!f.multiline, multiline: !!f.multiline, autoSize: false, align: 0, leadingPx: 0 }))
  tags.push(T.placeObject2({ depth: depth++, charId: id, name: f.name, x: f.x, y: f.y }))
}
tags.push(T.doAction(), T.showFrame(), T.endTag())

const as2 = `// Spike 05 S-A (not product code). Every input path we can think of logs to Inkwell.log as "[AS2] [menu] [] [spike05a] #n ...".
_global.gfxExtensions = true;
var CTX = "${ctx}";
var manual = ${manual};
var seq = 0;
var hist = new Array();
var glued = false;
var chk = 0;
var frames = 0;
var btns = [b1, b2, b3, b4];
var cols = new Array();
function say(s) {
  if (typeof(_root.inkwell.log) == "function") { _root.inkwell.log("info", "", "[spike05a] " + s); }
  else if (_root.inkwellTrace) { _root.inkwellTrace("[spike05a] " + s); }
}
function dev() { return (typeof(_root.inkwell.getInputDevice) == "function") ? _root.inkwell.getInputDevice() : "n/a"; }
function show(kind, detail) {
  seq++;
  var s = "#" + seq + " " + kind + " " + detail + " | device=" + dev() + " focus=" + Selection.getFocus();
  last.text = s;
  hist.push(s);
  if (hist.length > 8) { hist.shift(); }
  histTxt.text = hist.join(String.fromCharCode(13));
  say(s);
}
function dump(o) { var s = ""; for (var k in o) { s += k + "=" + o[k] + " "; } return s; }
function paint() {
  var f = Selection.getFocus();
  for (var i = 0; i < 4; i++) { cols[i].setRGB(f == targetPath(btns[i]) ? 0xE0A030 : 0x305080); }
}
function moveTo(i) {
  var ok = Selection.setFocus(btns[i]);
  show("setFocus(b" + (i + 1) + ")", "returned " + ok);
  paint();
}
function toggleManual() { manual = !manual; show("manual nav", String(manual)); }
function nav(a) {
  var cur = -1;
  for (var i = 0; i < 4; i++) { if (Selection.getFocus() == targetPath(btns[i])) { cur = i; } }
  if (cur < 0) { moveTo(0); return; }
  var row = cur >> 1;
  var col = cur & 1;
  if (a == "Left") { col = 0; } else if (a == "Right") { col = 1; } else if (a == "Up") { row = 0; } else if (a == "Down") { row = 1; }
  moveTo(row * 2 + col);
}
function manualAction(a) {
  if (a == "Left" || a == "Right" || a == "Up" || a == "Down") { nav(a); }
  else if (a == "Accept") { for (var i = 0; i < 4; i++) { if (Selection.getFocus() == targetPath(btns[i])) { btns[i].onRelease(); } } }
}
for (var i = 0; i < 4; i++) {
  var b = btns[i];
  cols[i] = new Color(b);
  b.idx = i;
  b.tabEnabled = true;
  b.focusEnabled = true;
  b._focusrect = true;
  b.onSetFocus = function(old) { show("btn" + (this.idx + 1) + ".onSetFocus", "old=" + old); paint(); };
  b.onKillFocus = function(nw) { show("btn" + (this.idx + 1) + ".onKillFocus", "new=" + nw); };
  b.onPress = function() { show("btn" + (this.idx + 1) + ".onPress", ""); };
  b.onRelease = function() { show("btn" + (this.idx + 1) + ".onRelease", ""); if (this.idx == 3) { toggleManual(); } };
}
paint();
var sl = new Object();
sl.onSetFocus = function(old, nw) { show("Selection.onSetFocus", "old=" + old + " new=" + nw); paint(); };
Selection.addListener(sl);
var kl = new Object();
kl.onKeyDown = function() {
  var c = Key.getCode();
  show("Key.onKeyDown", "code=" + c + " ascii=" + Key.getAscii());
  chk = 2;
  if (c == 77) { toggleManual(); }
  else if (c >= 49 && c <= 52) { moveTo(c - 49); }
  else if (c == 53) { show("setFocus(string)", "returned " + Selection.setFocus("_level0.b2")); paint(); }
  else if (manual) { manualAction(c == 37 ? "Left" : c == 39 ? "Right" : c == 38 ? "Up" : c == 40 ? "Down" : c == 13 ? "Accept" : ""); }
};
kl.onKeyUp = function() { show("Key.onKeyUp", "code=" + Key.getCode() + " ascii=" + Key.getAscii()); };
Key.addListener(kl);
// the Scaleform/CLIK-style input entry points, in case the engine calls them on _root (details = {value, code, navEquivalent, controlName, ...})
_root.handleInput = function(details, path) { show("_root.handleInput", dump(details) + "path=" + path); return false; };
_root.processInput = function(a, b, c) { show("_root.processInput", a + "," + b + "," + c); return false; };
// the runtime's own forwarding (Input.cpp: engine user events Up/Down/Left/Right/Accept/Cancel/... reach _root.inkwellMenu.onInput)
_root.inkwellMenu = {
  onOpen: function() {
    show("inkwellMenu.onOpen", "CTX=" + CTX);
    say("bridge members: " + dump(_root.inkwell));
    moveTo(0);
  },
  onClose: function() { show("inkwellMenu.onClose", ""); },
  onInput: function(a) { show("inkwellMenu.onInput", "action=" + a); if (manual) { manualAction(a); } },
  onMessage: function() {},
  onModEvent: function() {}
};
_root.onEnterFrame = function() {
  frames++;
  if (!glued && _root.inkwell.ready == true && typeof(_root.inkwell.glueReady) == "function") {
    glued = true;
    say("bridge ready, calling glueReady (CTX=" + CTX + " manual=" + manual + ")");
    _root.inkwell.glueReady();
  }
  if (chk > 0) { chk--; if (chk == 0) { show("focus check", "2 frames after the last key"); paint(); } }
  if (frames % 10 == 0) {
    state.text = "state: device=" + dev() + "  focus=" + Selection.getFocus() + "  manual=" + manual + "  glue=" + glued + "  ctx=" + CTX;
  }
};
`

async function main(): Promise<void> {
  const ffdec = createFfdecWrapper({
    javaPath: process.env['INKWELL_JAVA'] ?? 'java',
    ffdecDir: process.env['INKWELL_FFDEC'] ?? 'C:\\Program Files (x86)\\FFDec',
    jarPath: resolve(root, 'tools/ffdec-wrapper/build/ffdec-wrapper.jar')
  })
  try {
    const dir = mkdtempSync(resolve(tmpdir(), 'inkwell-spike05a-'))
    const w = (rel: string, data: string | Buffer): void => { mkdirSync(dirname(resolve(dir, rel)), { recursive: true }); writeFileSync(resolve(dir, rel), data) }
    w('base.swf', T.writeSwf({ widthPx: 1920, heightPx: 1080, tags }))
    const rectSvg = (id: number, wPx: number, hPx: number, fill: string, op: number): void =>
      w(`shapes/${id}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}" viewBox="0 0 ${wPx} ${hPx}"><rect width="${wPx}" height="${hPx}" fill="${fill}" fill-opacity="${op}"/></svg>`)
    rectSvg(panelId, 1840, 1000, '#101418', 0.92)
    rectSvg(btnShapeId, BTN.w, BTN.h, '#FFFFFF', 1) // tinted by AS2 Color: blue idle, orange focused
    w('as2/frame_1/DoAction.as', as2)
    const out = resolve(dest, 'Interface', 'Inkwell', MOD, 'Menu.swf')
    mkdirSync(dirname(out), { recursive: true })
    const r = await ffdec.build({ base: resolve(dir, 'base.swf'), shapes: resolve(dir, 'shapes'), scripts: resolve(dir, 'as2'), out })
    if (!r.ok) throw new Error(`FFDec build failed: ${r.error ?? 'unknown'}`)
    console.log(`wrote ${out} (${readFileSync(out).length} bytes, ffdec ${r.ms.toFixed(0)} ms)`)
  } finally {
    ffdec.stop()
  }

  const menu: Record<string, unknown> = {
    depth: 3, flags: { closeOnEscape: true, cursor: true, modal: true, pausesGame: true }, minRuntime: '0.4.0',
    name: MENU, specVersion: 7, swf: `Interface/Inkwell/${MOD}/Menu.swf`, triggers: { hotkey: 87, modEvent: `${MOD}_Open`, papyrus: true }
  }
  if (ctx !== 'absent') menu['inputContext'] = ctx
  const mj = resolve(dest, 'SKSE', 'Plugins', 'Inkwell', 'menus', `${MENU}.json`)
  mkdirSync(dirname(mj), { recursive: true })
  writeFileSync(mj, JSON.stringify(Object.fromEntries(Object.entries(menu).sort(([a], [b]) => a.localeCompare(b))), null, 2) + '\n')

  const outDll = resolve(dest, 'SKSE', 'Plugins', 'Inkwell.dll')
  mkdirSync(dirname(outDll), { recursive: true })
  copyFileSync(dll, outDll)
  console.log(`deployed spike 05A to ${dest} (menu ${MENU}, hotkey F11, inputContext ${ctx}, manual ${manual})`)
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 })
