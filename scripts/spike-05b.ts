// yarn spike:05b [--mods <MO2 mods folder>] -> spike S-B of PLAN-0.5: a modded InventoryMenu.swf built from the draft engine contract only
// (Inkwell-Spec/spikes/inventory-contract/inventory.contract.draft.json), as 8 MO2 mod folders "Inkwell Spike 05B - <n> <what>": a baseline with every
// contract name, 6 variants that each leave out one group and a SkyUI 5.2 check (7), so the owner learns which names the engine needs. Owner steps: TEST-IN-GAME-0.5.md, S-B.
// Built from scratch with the editor's tag writer + FFDec: no vanilla bytes are copied. The vanilla cache is read only for the stage header, and every
// output is checked against the cache's hashes (an unmodified vanilla SWF is never written). Nothing here is product code. Needs Java, FFDec, the wrapper jar.
// Trace: an engine menu gets no Inkwell bridge (the runtime only bridges its own menus), so lines go to skse64.log through skse.Log
// (proven for the HUD in 0.1) and to a log box on screen. Inkwell.log gets nothing from this spike.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { inflateSync } from 'node:zlib'
import { createFfdecWrapper } from '../src/main/build/ffdecWrapper'
import { parseSwf } from '../src/main/swf/swfReader.testutil'
import * as T from '../src/main/swf/tags'
import { isUnmodifiedVanilla, loadVanillaHashes, vanillaCacheRoot, vanillaCacheStatus } from '../src/main/vanilla/cache'

const root = resolve(__dirname, '..')
const arg = (k: string): string | undefined => {
  const i = process.argv.indexOf(k)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const modsRoot = resolve(arg('--mods') ?? process.env['INKWELL_MO2_MODS'] ?? 'C:\\Modding\\MO2\\mods')
const userData = process.env['INKWELL_USERDATA'] ?? join(process.env['APPDATA'] ?? '', 'inkwell-editor')
const PREFIX = 'Inkwell Spike 05B - '

type Group = 'GetInventoryItemList' | 'init' | 'Menu_mc' | 'itemCard' | 'bridge' | 'listMembers'
interface Variant { n: number; folder: string; omit?: Group; skyui?: boolean; desc: string; absent: string[]; present?: string[] }
// absent: strings that must not occur in that variant's SWF (self-check); every other variant must contain them. present: the reverse (only that variant has them).
const VARIANTS: Variant[] = [
  { n: 0, folder: '0 baseline', desc: 'baseline, every contract name', absent: [] },
  { n: 1, folder: '1 no item list', omit: 'GetInventoryItemList', desc: 'root item-list function removed', absent: ['GetInventoryItemList'] },
  { n: 2, folder: '2 no init', omit: 'init', desc: 'root init and platform functions removed', absent: ['InitExtensions', 'SetPlatform'] },
  { n: 3, folder: '3 no Menu_mc', omit: 'Menu_mc', desc: 'menu clip renamed to Spike_mc', absent: ['Menu_mc'] },
  { n: 4, folder: '4 no item card', omit: 'itemCard', desc: 'item card handler and request removed', absent: ['UpdateItemCardInfo', 'RequestItemCardInfo'] },
  { n: 5, folder: '5 no bridge', omit: 'bridge', desc: 'ExternalInterface call/respond not registered', absent: ['addCallback'] },
  { n: 6, folder: '6 bare list', omit: 'listMembers', desc: 'list object has entryList only', absent: ['selectedIndex', 'selectedEntry', 'scrollPosition', 'InvalidateData'] },
  { n: 7, folder: '7 skyui52 check', skyui: true, desc: 'baseline plus the _global version statics SkyUI 5.2 checks', absent: [], present: ['SKYUI_RELEASE_IDX', 'SKYUI_VERSION_STRING'] }
]

const has = (v: Variant, o: Group): boolean => v.omit !== o

// SkyUI 5.2 SKI_Main reads _global.<Class>.SKYUI_RELEASE_IDX / SKYUI_VERSION_STRING for these four classes
const SKYUI_CLASSES = ['InventoryMenu', 'ItemCard', 'BottomBar', 'InventoryLists']
const SKYUI_BLOCK = `${SKYUI_CLASSES.map((x) => `_global.${x} = function() {};
_global.${x}.SKYUI_RELEASE_IDX = 2018;
_global.${x}.SKYUI_VERSION_STRING = "5.2 SE";
`).join('')}L("SkyUI 5.2 globals defined: ${SKYUI_CLASSES.join(', ')}");
${SKYUI_CLASSES.map((x) => `L("read back _global.${x}: idx=" + _global.${x}.SKYUI_RELEASE_IDX + " ver=" + _global.${x}.SKYUI_VERSION_STRING);`).join('\n')}
`

function as2(v: Variant): string {
  const MENU = has(v, 'Menu_mc') ? 'Menu_mc' : 'Spike_mc'
  const card = has(v, 'itemCard')
  const props = has(v, 'listMembers')
  const out: string[] = []
  out.push(`// Spike 05B variant ${v.n} (${v.desc}). Not product code. Every line goes to skse64.log through skse.Log and to the log box.
_global.gfxExtensions = true;
var GL = _global;
var VID = "05B-${v.n}";
var NL = String.fromCharCode(10);
var t0 = getTimer();
var logQ = [];
var shown = [];
var counts = {};
var M = ${MENU};
var LIST = undefined;
var entries = [];
var sel = 0;
var quiet = false;
var pending = {};
var nextId = 0;
var handlers = {};
var faded = false;
var sk = false;
var highlighted = false;

function flush() {
  if (typeof(GL.skse) == "object" && GL.skse.Log != undefined) {
    while (logQ.length > 0) { GL.skse.Log(String(logQ.shift())); }
  }
}
function L(s) {
  logQ.push("[Spike05B " + VID + "] " + (getTimer() - t0) + "ms " + s);
  if (logQ.length > 400) { logQ.shift(); }
  shown.push(String(s).substr(0, 160));
  if (shown.length > 13) { shown.shift(); }
  M.logText.text = shown.join(NL);
  flush();
}
function cnt(k) {
  if (counts[k] == undefined) { counts[k] = 0; }
  counts[k] = counts[k] + 1;
  return counts[k];
}
function keys(o, max) {
  var a = [];
  for (var k in o) {
    if (a.length < max) {
      var x = o[k];
      a.push(k + "=" + (typeof(x) == "object" ? "[obj]" : (typeof(x) == "function" ? "[fn]" : String(x).substr(0, 30))));
    }
  }
  return a.join(", ");
}
function val(x) {
  if (typeof(x) == "object") { return "{" + keys(x, 12) + "}"; }
  return String(x).substr(0, 40);
}
function args(a, from) {
  var r = [];
  for (var i = from; i < a.length; i++) { r.push(val(a[i])); }
  return r.join(" | ");
}
function seen(n, extra) {
  if (quiet) { return; }
  var c = cnt("list:" + n);
  if (c <= 2) { L("engine used list." + n + extra + " (#" + c + ")"); }
}
function spy(where) {
  return function(n) {
    if (n.substr(0, 2) != "on" && cnt("res:" + where + n) == 1) { L("lookup of missing " + where + "." + n); }
    return undefined;
  };
}
function ents() {
  quiet = true;
  var e = LIST.entryList;
  quiet = false;
  if (e == undefined) { e = []; }
  return e;
}
function render() {
  var e = ents();
  var out = [];
  var first = Math.max(0, Math.min(sel - 8, e.length - 18));
  for (var i = first; i < e.length && i < first + 18; i++) {
    var it = e[i];
    out.push((i == sel ? "> " : "   ") + it.text + (it.count > 1 ? " (" + it.count + ")" : "") + (it.equipState > 0 ? "  [E]" : ""));
  }
  M.items.text = "Items: " + e.length + NL + out.join(NL);
}

// as->engine, same wire format as gfx.io.GameDelegate.call (the respond entry is removed right after the call, as vanilla does)
function toEngine(m, p, cb) {
  var id = nextId++;
  if (cb != undefined) { pending[id] = cb; }
  var n = cnt("out:" + m);
  if (n <= 3 || n % 20 == 0) { L("as->engine " + m + "(" + args(p, 0) + ")" + (n > 3 ? " #" + n : "")); }
  p.unshift(m, id);
  var r = flash.external.ExternalInterface.call.apply(null, p);
  if (pending[id] != undefined) {
    delete pending[id];
    if (n <= 3) { L("  " + m + ": no respond during the call"); }
  }
  if (r != undefined) { L("  " + m + " returned " + val(r)); }
}
// engine->as through the ExternalInterface callback "call": logs every name, handled or not
function onCall(name) {
  var h = handlers[name];
  var n = cnt("call:" + name);
  if (n <= 3 || n % 20 == 0) { L("engine->as " + name + "(" + args(arguments, 1) + ")" + (h == undefined ? " [no handler]" : "") + (n > 3 ? " #" + n : "")); }
  if (h != undefined) { return h.apply(null, arguments.slice(1)); }
  return undefined;
}
function onRespond(uid) {
  var cb = pending[uid];
  delete pending[uid];
  if (cnt("respond") <= 3) { L("engine->as respond uid=" + uid + (cb == undefined ? " [no pending call]" : "") + " " + args(arguments, 1)); }
  if (cb != undefined) { cb.apply(null, arguments.slice(1)); }
}
`)
  if (has(v, 'init')) {
    out.push(`function InitExtensions() { L("engine called _root.InitExtensions(" + args(arguments, 0) + ")"); }
function SetPlatform(aiPlatform, abPS3Switch) { L("engine called _root.SetPlatform(" + aiPlatform + ", " + abPS3Switch + ")"); }
`)
  }
  if (has(v, 'GetInventoryItemList')) {
    out.push(`function GetInventoryItemList() {
  var n = cnt("gil");
  if (n <= 3) { L("engine called _root.GetInventoryItemList() #" + n); }
  return LIST;
}
`)
  }
  out.push(`
function highlight(i) {
  var e = ents();
  if (e.length == 0) { return; }
  sel = Math.max(0, Math.min(i, e.length - 1));
  highlighted = true;
  render();
  toEngine("PlaySound", ["UIMenuFocus"]);
  toEngine("UpdateItem3D", [true]);
${card ? '  toEngine("RequestItemCardInfo", [], showCard);\n' : ''}}
function select() {
  var it = ents()[sel];
  if (it == undefined) { return; }
  if (it.enabled == false) { toEngine("DisabledItemSelect", []); } else { toEngine("ItemSelect", []); }
}
function closeMenu(tween) {
  toEngine("SaveIndices", [[0, sel]]);
  if (tween) { toEngine("CloseTweenMenu", []); }
  toEngine("CloseMenu", []);
}
${card ? `function showCard(o) {
  if (cnt("card") <= 2) { L("  item card fields: " + keys(o, 40)); }
  M.card.text = "Item card" + NL + o.name + NL + "type " + o.type + "  value " + o.value + "  weight " + o.weight + (o.damage != undefined ? "  damage " + o.damage : "") + (o.armor != undefined ? "  armor " + o.armor : "");
}
handlers.UpdateItemCardInfo = showCard;
` : 'M.card.text = "Item card: left out in this variant";\n'}handlers.UpdatePlayerInfo = function(o) { if (cnt("upi") <= 1) { L("  player info fields: " + keys(o, 30)); } };
handlers.ToggleMenuFade = function() { faded = !faded; M._alpha = faded ? 40 : 100; };
handlers.RestoreIndices = function() { };
handlers.SetCategoriesList = function() {
  var names = [];
  for (var i = 0; i + 2 < arguments.length; i += 3) { names.push(arguments[i + 1] == 0 ? "--" : arguments[i]); }
  M.cats.text = "Categories: " + names.length + NL + names.join(NL);
};
handlers.InvalidateListData = function() {
  var e = ents();
  if (cnt("ild") <= 2) { L("  entryList length=" + e.length + (e.length > 0 ? " entry0: " + keys(e[0], 30) : "")); }
  render();
  if (!highlighted) { highlight(sel); }
};
handlers.AttemptEquip = function(aiSlot, abCheckOverList) { toEngine("ItemSelect", [aiSlot]); };
handlers.DropItem = function() { toEngine("ItemDrop", [1]); };
handlers.AttemptChargeItem = function() { };
handlers.ItemRotating = function() { };

// the item list object the engine fills (contract inst.itemListObject); getters log what the engine reads
LIST = M.createEmptyMovieClip("ItemList", 100);
`)
  out.push(props
    ? `LIST.addProperty("entryList", function() { seen("entryList", " get"); return entries; }, function(x) { seen("entryList", " set, length " + x.length); entries = x; });
LIST.addProperty("selectedIndex", function() { seen("selectedIndex", " get -> " + sel); return sel; }, function(x) { seen("selectedIndex", " set " + x); sel = Number(x); render(); });
LIST.addProperty("selectedEntry", function() { seen("selectedEntry", " get"); return entries[sel]; }, null);
LIST.addProperty("scrollPosition", function() { seen("scrollPosition", " get"); return 0; }, function(x) { seen("scrollPosition", " set " + x); });
LIST.addProperty("length", function() { seen("length", " get"); return entries.length; }, null);
LIST.InvalidateData = function() { seen("InvalidateData", "()"); render(); };
LIST.UpdateList = function() { seen("UpdateList", "()"); render(); };
`
    : `LIST.entryList = entries;
`)
  out.push(`LIST.__resolve = spy("list");
M.__resolve = spy("${MENU}");

var keyL = {};
keyL.onKeyDown = function() {
  var c = Key.getCode();
  if (cnt("key" + c) <= 2) { L("key " + c); }
  if (c == 38) { highlight(sel - 1); }
  else if (c == 40) { highlight(sel + 1); }
  else if (c == 13) { select(); }
  else if (c == 9) { closeMenu(true); }
  else if (c == 27) { closeMenu(false); }
};
Key.addListener(keyL);
`)
  if (has(v, 'bridge')) {
    out.push(`var okCall = flash.external.ExternalInterface.addCallback("call", this, onCall);
var okResp = flash.external.ExternalInterface.addCallback("respond", this, onRespond);
`)
  } else out.push('var okCall = "left out";\nvar okResp = "left out";\n')
  out.push(`M.title.text = "Inkwell Spike " + VID + ": ${v.desc}.   Up/Down select, Enter use, Tab or Esc close";
L("frame 1 ran: menu clip ${MENU}, bridge call=" + okCall + " respond=" + okResp + ", skse=" + typeof(GL.skse) + ", stage " + Stage.width + "x" + Stage.height);
${v.skyui ? SKYUI_BLOCK : ''}this.onEnterFrame = function() {
  if (!sk && typeof(GL.skse) == "object") { sk = true; L("skse object present"); }
  flush();
};
// last: a lookup of a missing root name (by the engine or a mod) is logged once; globals still resolve through _global
_root.__resolve = function(n) {
  if (GL[n] == undefined && n.substr(0, 2) != "on" && cnt("res:_root" + n) == 1) { L("lookup of missing _root." + n); }
  return GL[n];
};
`)
  return out.join('')
}

const FONT = 1
const white = { r: 255, g: 255, b: 255, a: 255 }
interface Field { name: string; x: number; y: number; w: number; h: number; size: number; text: string }
const FIELDS: Field[] = [
  { name: 'title', x: 30, y: 14, w: 1220, h: 28, size: 17, text: 'Inkwell Spike 05B' },
  { name: 'cats', x: 30, y: 52, w: 220, h: 420, size: 15, text: 'Categories: none yet' },
  { name: 'items', x: 260, y: 52, w: 470, h: 420, size: 15, text: 'Items: none yet' },
  { name: 'card', x: 750, y: 52, w: 500, h: 200, size: 15, text: 'Item card: none yet' },
  { name: 'logText', x: 30, y: 480, w: 1220, h: 230, size: 12, text: 'log: frame 1 did not run' }
]

function swfBase(menu: string, w: number, h: number, version: number): Buffer {
  const PANEL = 10
  const SPRITE = 30
  const tags: Buffer[] = [T.setBackgroundColor(0, 0, 0), T.importAssets2('gfxfontlib.swf', { id: FONT, name: '$EverywhereMediumFont' }), T.defineShapePlaceholder(PANEL, w, h)]
  const inner: Buffer[] = [T.placeObject2({ depth: 1, charId: PANEL, x: 0, y: 0 })]
  FIELDS.forEach((f, i) => {
    const id = 11 + i
    tags.push(T.defineEditText({ id, wPx: f.w, hPx: f.h, fontId: FONT, sizePx: f.size, color: white, text: f.text, wordWrap: true, multiline: f.name !== 'title', autoSize: false, align: 0, leadingPx: 0 }))
    inner.push(T.placeObject2({ depth: 2 + i, charId: id, name: f.name, x: f.x, y: f.y }))
  })
  tags.push(T.sprite(SPRITE, inner), T.placeObject2({ depth: 1, charId: SPRITE, name: menu, x: 0, y: 0 }), T.doAction(), T.showFrame(), T.endTag())
  return T.writeSwf({ version, widthPx: w, heightPx: h, tags })
}

const plain = (b: Buffer): Buffer => (b.toString('ascii', 0, 3) === 'CWS' ? Buffer.concat([Buffer.from('FWS'), b.subarray(3, 8), inflateSync(b.subarray(8))]) : b)

async function main(): Promise<void> {
  if (!existsSync(modsRoot)) throw new Error(`MO2 mods folder not found: ${modsRoot} (use --mods)`)
  // stage size and SWF version from the user's own vanilla file; the contract's values when the cache is not built
  const cache = await vanillaCacheStatus({ cacheRoot: vanillaCacheRoot(userData) })
  let stage = { w: 1280, h: 720, version: 15, from: 'the draft contract (vanilla cache not built)' }
  const vanillaInv = cache.dir ? join(cache.dir, 'interface', 'inventorymenu.swf') : undefined
  if (vanillaInv && existsSync(vanillaInv)) {
    const p = parseSwf(plain(readFileSync(vanillaInv)))
    stage = { w: p.frameSize.x1 / 20, h: p.frameSize.y1 / 20, version: p.version, from: `the vanilla cache ${cache.dir}` }
  }
  console.log(`stage ${stage.w}x${stage.h}, SWF ${stage.version}, from ${stage.from}`)
  const hashes = await loadVanillaHashes(vanillaCacheRoot(userData))
  if (hashes.size === 0) console.warn('vanilla cache empty: the unmodified-vanilla check has nothing to compare against (the SWFs are built from scratch anyway)')

  const ffdec = createFfdecWrapper({
    javaPath: process.env['INKWELL_JAVA'] ?? 'java',
    ffdecDir: process.env['INKWELL_FFDEC'] ?? 'C:\\Program Files (x86)\\FFDec',
    jarPath: resolve(root, 'tools/ffdec-wrapper/build/ffdec-wrapper.jar')
  })
  // variant 7 differs from the baseline script only by the SkyUI block (variant number and description aside)
  const v7 = VARIANTS[7]!
  if (as2(v7).replace(SKYUI_BLOCK, '') !== as2({ ...VARIANTS[0]!, n: v7.n, desc: v7.desc })) throw new Error('variant 7 differs from the baseline by more than the SkyUI block')
  try {
    for (const v of VARIANTS) {
      const menu = has(v, 'Menu_mc') ? 'Menu_mc' : 'Spike_mc'
      const dir = mkdtempSync(resolve(tmpdir(), 'inkwell-spike05b-'))
      const w = (rel: string, data: string | Buffer): void => { mkdirSync(dirname(resolve(dir, rel)), { recursive: true }); writeFileSync(resolve(dir, rel), data) }
      w('base.swf', swfBase(menu, stage.w, stage.h, stage.version))
      w('shapes/10.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="${stage.w}" height="${stage.h}" viewBox="0 0 ${stage.w} ${stage.h}"><rect width="${stage.w}" height="${stage.h}" fill="#0b0f14" fill-opacity="0.82"/></svg>`)
      w('as2/frame_1/DoAction.as', as2(v))
      const built = resolve(dir, 'inventorymenu.swf')
      const r = await ffdec.build({ base: resolve(dir, 'base.swf'), shapes: resolve(dir, 'shapes'), scripts: resolve(dir, 'as2'), out: built })
      if (!r.ok) throw new Error(`FFDec build failed for variant ${v.n}: ${r.error ?? 'unknown'}`)
      const bytes = readFileSync(built)
      if (isUnmodifiedVanilla(bytes, hashes)) throw new Error(`variant ${v.n} is byte-identical to a vanilla SWF; refusing to deploy it`)
      // self-check: each variant lacks exactly its own group's names and keeps every other group's
      const text = plain(bytes).toString('latin1')
      for (const o of VARIANTS) for (const s of o.absent) {
        if ((o === v) === text.includes(s)) throw new Error(`variant ${v.n}: "${s}" ${o === v ? 'is still in' : 'is missing from'} the SWF`)
      }
      for (const o of VARIANTS) for (const s of o.present ?? []) {
        if ((o === v) !== text.includes(s)) throw new Error(`variant ${v.n}: "${s}" ${o === v ? 'is missing from' : 'is in'} the SWF`)
      }
      const dest = resolve(modsRoot, PREFIX + v.folder)
      const out = resolve(dest, 'Interface', 'inventorymenu.swf')
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, bytes)
      rmSync(dir, { recursive: true, force: true })
      console.log(`variant ${v.n}: ${out} (${bytes.length} bytes, ffdec ${r.ms.toFixed(0)} ms)`)
    }
  } finally {
    ffdec.stop()
  }
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 })
