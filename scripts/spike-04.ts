// yarn spike:04 [--to <mods\name>] [--dll <Inkwell.dll>] -> the 0.4 Phase 1 spike menu (PLAN-0.4): embedded DefineFont3 (S-A), $KEY translation (S-B), runtime colour/position changes (S-C).
// Builds ONE test menu SWF with the editor's tag writer + FFDec, plus the menu JSON, two translation files and the runtime DLL, into one MO2 mod folder (default "Inkwell Spike 04").
// Nothing here is product code; the real implementation comes after the owner's results. Never the game's Data folder, never another mod's folder. Needs Java, FFDec and the wrapper jar.
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
const MOD = 'InkwellSpike04'
const MENU = `${MOD}_Menu`
const dest = resolve(arg('--to') ?? 'C:\\Modding\\MO2\\mods\\Inkwell Spike 04')
if (!/[\\/]mods[\\/][^\\/]+$/i.test(dest) || /[\\/]data([\\/]|$)/i.test(dest)) throw new Error(`Refusing ${dest}: it must be one MO2 mod folder (...\\mods\\<name>).`)
const dll = resolve(arg('--dll') ?? process.env['INKWELL_RUNTIME_DLL'] ?? 'D:/Mods/Inkwell/Inkwell-Runtime/build/Release/Inkwell.dll')
if (!existsSync(dll)) throw new Error(`Runtime DLL not found: ${dll}`)

const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('')
const white = { r: 255, g: 255, b: 255, a: 255 }
const font = (name: string): Buffer => readFileSync(resolve(root, 'resources/preview-fonts', name))

// character ids: 1 mono (full ASCII + German), 2 Barlow Bold (digits only), 3 alias import, then fields
const FONT_MONO = 1
const FONT_DIGITS = 2
const FONT_ALIAS = 3
const fonts = [
  { id: FONT_MONO, ttf: 'ShareTechMono-Regular.ttf', chars: ASCII + 'äöüÄÖÜß' },
  { id: FONT_DIGITS, ttf: 'BarlowCondensed-Bold.ttf', chars: '0123456789:. ' }
]

interface Field { name: string; x: number; y: number; w: number; h: number; font: number; size: number; text: string; multiline?: boolean }
const F: Field[] = [
  { name: 'h_a', x: 80, y: 60, w: 900, h: 40, font: FONT_ALIAS, size: 28, text: 'S-A  embedded font (DefineFont3, subset)' },
  { name: 'a1', x: 80, y: 110, w: 900, h: 80, font: FONT_MONO, size: 64, text: '12:34.567' },
  { name: 'a2', x: 80, y: 200, w: 1100, h: 44, font: FONT_MONO, size: 32, text: 'Zurücksetzen Rundenzeit ÄÖÜ ß' },
  { name: 'a3', x: 80, y: 255, w: 1100, h: 50, font: FONT_DIGITS, size: 40, text: '0123 ABC 45' },
  { name: 'a4', x: 80, y: 315, w: 1100, h: 44, font: FONT_ALIAS, size: 28, text: 'alias for comparison: Everywhere Medium' },
  { name: 'h_b', x: 80, y: 390, w: 900, h: 40, font: FONT_ALIAS, size: 28, text: 'S-B  $KEY translation (alias font unless noted)' },
  { name: 'b1', x: 80, y: 440, w: 1500, h: 40, font: FONT_ALIAS, size: 28, text: '$Inkwell_Spike04_Hello' },
  { name: 'b2', x: 80, y: 485, w: 1500, h: 44, font: FONT_MONO, size: 32, text: '$Inkwell_Spike04_Umlaut' },
  { name: 'b3', x: 80, y: 535, w: 1500, h: 40, font: FONT_ALIAS, size: 28, text: '$Inkwell_Spike04_Missing' },
  { name: 'b4', x: 80, y: 580, w: 1500, h: 40, font: FONT_ALIAS, size: 28, text: '(set by AS2 at start)' },
  { name: 'b5', x: 80, y: 625, w: 1500, h: 40, font: FONT_ALIAS, size: 28, text: '(set by AS2 after 3 s)' },
  { name: 'b6', x: 80, y: 670, w: 1500, h: 40, font: FONT_ALIAS, size: 28, text: '$INKWELL_SPIKE04_HELLO' },
  { name: 'b7', x: 80, y: 715, w: 1500, h: 90, font: FONT_ALIAS, size: 28, text: '$Inkwell_Spike04_Lines', multiline: true },
  { name: 'v1', x: 1000, y: 440, w: 800, h: 40, font: FONT_ALIAS, size: 28, text: '$Yes' },
  { name: 'v2', x: 1000, y: 485, w: 800, h: 40, font: FONT_ALIAS, size: 28, text: '$Cancel' },
  { name: 'v3', x: 1000, y: 535, w: 800, h: 40, font: FONT_ALIAS, size: 28, text: '$Exit' },
  { name: 'v4', x: 1000, y: 580, w: 800, h: 40, font: FONT_ALIAS, size: 28, text: '(AS2: $Yes)' },
  { name: 'h_v', x: 1000, y: 390, w: 800, h: 40, font: FONT_ALIAS, size: 28, text: 'vanilla keys (control)' },
  { name: 'h_c', x: 80, y: 830, w: 900, h: 40, font: FONT_ALIAS, size: 28, text: 'S-C  AS2 changes after 3 s (box right of this line, colour text)' },
  { name: 'c1', x: 80, y: 880, w: 900, h: 40, font: FONT_ALIAS, size: 28, text: 'this text turns red' },
  { name: 'status', x: 80, y: 940, w: 1700, h: 80, font: FONT_ALIAS, size: 24, text: 'waiting for AS2...', multiline: true }
]

const tags: Buffer[] = [T.setBackgroundColor(0, 0, 0)]
tags.push(T.importAssets2('gfxfontlib.swf', { id: FONT_ALIAS, name: '$EverywhereMediumFont' }))
tags.push(T.defineFont3Placeholder(FONT_MONO, 'ShareTechMono'), T.defineFont3Placeholder(FONT_DIGITS, 'BarlowCondensedBold'))
let nextId = 10
const panelId = nextId++
const boxId = nextId++
const boxClipId = nextId++ // a shape has no _x/_width in AS2: it needs a sprite around it (the real generator does the same)
tags.push(T.defineShapePlaceholder(panelId, 1840, 1000), T.defineShapePlaceholder(boxId, 160, 60), T.sprite(boxClipId, [T.placeObject2({ depth: 1, charId: boxId, x: 0, y: 0 })]))
let depth = 1
tags.push(T.placeObject2({ depth: depth++, charId: panelId, x: 40, y: 40 }))
tags.push(T.placeObject2({ depth: depth++, charId: boxClipId, name: 'box', x: 1000, y: 830 }))
for (const f of F) {
  const id = nextId++
  tags.push(T.defineEditText({ id, wPx: f.w, hPx: f.h, fontId: f.font, sizePx: f.size, color: white, text: f.text, wordWrap: !!f.multiline, multiline: !!f.multiline, autoSize: false, align: 0, leadingPx: 0 }))
  tags.push(T.placeObject2({ depth: depth++, charId: id, name: f.name, x: f.x, y: f.y }))
}
tags.push(T.doAction(), T.showFrame(), T.endTag())

const as2 = `// Spike 04 (not product code). say() writes to Inkwell.log through the runtime's legacy alias once it exists.
_global.gfxExtensions = true;
var n = 0;
var done = false;
function say(s) { if (_root.inkwellTrace) { _root.inkwellTrace("[spike04] " + s); } }
b4.text = "$Inkwell_Spike04_Hello";
v4.text = "$Yes";
var translated = false;
// S-B2 (runtime 0.4.0): what the generated menu class does in begin(): ask the runtime, keep the compiled text when it has no answer
function tx(field) {
  var key = field.text;
  var t = _root.inkwell.translate(key);
  if (t != undefined && t != key) { field.text = t; }
}
_root.onEnterFrame = function() {
  n++;
  if (!translated && _root.inkwell.ready == true && _root.inkwell.translate != undefined) {
    translated = true;
    say("runtime 0.4.0 bridge: language=" + _root.inkwell.language + " translate=" + typeof(_root.inkwell.translate));
    tx(b1); tx(b2); tx(b3); tx(b4); tx(b6); tx(b7);
    tx(b5);
  }
  if (n == 60) {
    say("t=2s b1='" + b1.text + "' b2='" + b2.text + "' b3='" + b3.text + "' b4='" + b4.text + "' b6='" + b6.text + "' b7='" + b7.text + "' v1='" + v1.text + "' v2='" + v2.text + "' v3='" + v3.text + "' v4='" + v4.text + "'");
  }
  if (n == 90 && !done) {
    done = true;
    b5.text = "$Inkwell_Spike04_Hello";
    c1.textColor = 0xFF4040;
    var col = new Color(box);
    col.setRGB(0xE0A030);
    box._x = box._x + 300;
    box._width = box._width * 1.5;
    box._alpha = 50;
    var msg = "S-C readback: textColor=" + c1.textColor.toString(16) + " box._x=" + box._x + " box._width=" + box._width + " box._alpha=" + box._alpha + " tint=" + col.getRGB().toString(16);
    status.text = msg + String.fromCharCode(10) + "language=" + _root.inkwell.language + " b1='" + b1.text + "' b2='" + b2.text + "' b3='" + b3.text + "' b7='" + b7.text + "'";
    say(msg);
    say("b4(set at start)='" + b4.text + "' b5(set at 3s)='" + b5.text + "'");
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
    const dir = mkdtempSync(resolve(tmpdir(), 'inkwell-spike04-'))
    const w = (rel: string, data: string | Buffer): void => { mkdirSync(dirname(resolve(dir, rel)), { recursive: true }); writeFileSync(resolve(dir, rel), data) }
    w('base.swf', T.writeSwf({ widthPx: 1920, heightPx: 1080, tags }))
    const rectSvg = (id: number, wPx: number, hPx: number, fill: string, op: number): void =>
      w(`shapes/${id}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}" viewBox="0 0 ${wPx} ${hPx}"><rect width="${wPx}" height="${hPx}" fill="${fill}" fill-opacity="${op}"/></svg>`)
    rectSvg(panelId, 1840, 1000, '#101418', 0.92)
    rectSvg(boxId, 160, 60, '#3070D0', 1)
    for (const f of fonts) { w(`fonts/${f.id}.ttf`, font(f.ttf)); w(`fonts/${f.id}.txt`, f.chars) }
    w('as2/frame_1/DoAction.as', as2)
    const out = resolve(dest, 'Interface', 'Inkwell', MOD, 'Menu.swf')
    mkdirSync(dirname(out), { recursive: true })
    const r = await ffdec.build({ base: resolve(dir, 'base.swf'), shapes: resolve(dir, 'shapes'), fonts: resolve(dir, 'fonts'), scripts: resolve(dir, 'as2'), out })
    if (!r.ok) throw new Error(`FFDec build failed: ${r.error ?? 'unknown'}`)
    console.log(`wrote ${out} (${readFileSync(out).length} bytes, ffdec ${r.ms.toFixed(0)} ms)`)
  } finally {
    ffdec.stop()
  }

  const menu = {
    depth: 3, flags: { closeOnEscape: true, cursor: true, modal: true, pausesGame: true }, inputContext: 'menuMode', minRuntime: '0.4.0', translations: MOD,
    name: MENU, specVersion: 7, swf: `Interface/Inkwell/${MOD}/Menu.swf`, triggers: { hotkey: 68, modEvent: `${MOD}_Open`, papyrus: true }
  }
  const mj = resolve(dest, 'SKSE', 'Plugins', 'Inkwell', 'menus', `${MENU}.json`)
  mkdirSync(dirname(mj), { recursive: true })
  writeFileSync(mj, JSON.stringify(menu, null, 2) + '\n')

  // UTF-16 LE with BOM, TAB between key and text, CRLF (the format V3 proposes; the spike tests it). "\n" is written as the two characters backslash n.
  const tr = (rows: [string, string][]): Buffer => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(rows.map(([k, v]) => `${k}\t${v}\r\n`).join(''), 'utf16le')])
  const tdir = resolve(dest, 'Interface', 'Translations')
  mkdirSync(tdir, { recursive: true })
  writeFileSync(resolve(tdir, `${MOD}_ENGLISH.txt`), tr([['$Inkwell_Spike04_Hello', 'Hello world (English)'], ['$Inkwell_Spike04_Umlaut', 'Reset'], ['$Inkwell_Spike04_Lines', 'Line one\\nLine two']]))
  writeFileSync(resolve(tdir, `${MOD}_GERMAN.txt`), tr([['$Inkwell_Spike04_Hello', 'Hallo Welt (Deutsch)'], ['$Inkwell_Spike04_Umlaut', 'Zurücksetzen ÄÖÜ ß'], ['$Inkwell_Spike04_Lines', 'Zeile eins\\nZeile zwei']]))

  const outDll = resolve(dest, 'SKSE', 'Plugins', 'Inkwell.dll')
  mkdirSync(dirname(outDll), { recursive: true })
  copyFileSync(dll, outDll)
  console.log(`deployed spike 04 to ${dest} (menu ${MENU}, hotkey F10)`)
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 })
