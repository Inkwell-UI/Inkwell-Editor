# Spike 1 + 2: FFDec compile and AS2/GFx probes (milestone 0.0)

Status: **FINAL (2026-10-23, see `D:\Mods\Inkwell\SPIKES.md` sections 1, 2, 9). Spike 1: PASS (SWF loads in Skyrim SE 1.7.104) but the cold-compile target is missed (median 2.4 s). Spike 2: PASS with findings (try/catch works, no `Error` class, no AS2 filter classes, text needs outline fonts). GFx extensions `verticalAlign` and `textAutoSize` verified visually in-game (variant D); `shadowStyle` NOT confirmed.**

## Final in-game results (Skyrim SE 1.7.104, runtime-menu DLL spike)

Evidence: `SKSE\Inkwell.log` lines (identical across A/B/C over 9 opens, 26 lines each) and owner screenshots (relayed, not seen by the agent).

| Probe | Result | Evidence |
| --- | --- | --- |
| Spike 1: SWF v10 1280x720 loads | PASS: `LoadMovieEx returned true`, `_root exists: true`, AS2 report lines logged for A, B, C | log |
| a) try/catch/finally | OK for explicit throws in a frame script: `TRYCATCH: OK str=boom err=undefined isError=false fin=11 fin2=11 nested=c1:inner c2:re-inner`. `typeof Error == "undefined"` (so `new Error()` is unusable, throw strings/objects). Engine-called handlers untested | log |
| b) GFx extensions (presence) | `verticalAlign` (base `none`), `verticalAutoSize`, `textAutoSize` exist and reject bogus values; `noTranslate` base `false`; `shadowStyle` base `""` but drops writes; `autoShrink` does NOT exist | log |
| c) classes | `mods.inkwellspike.Probe` and `mods.other.Probe` coexist; `registerClass` + `attachMovie` work (custom-menu movie only, not the shared HUD movie) | log |
| d) environment | `$version` = `WIN 8,0,0,0`; no `gfx`/`skse` objects in a custom menu movie; `flash.filters.DropShadowFilter` undefined; `TextField.filters` inconclusive | log |
| Text A (vanilla import, `useOutlines=true`) | renders in Skyrim's font | user screenshot |
| Text B (`fontClass`, device text) | draws nothing (log `font=Times New Roman ... embedFonts=false`, `textWidth(W)=textWidth(i)=885`); log-confirmed only, the owner's 'P' screenshot showed A's content | log |
| Text C (local glyph-less `DefineFont2`, `useOutlines=true`) | renders, widths 194/50 | user screenshot + log |
| Runtime `createTextField` + `embedFonts=true` + `font=$EverywhereFont` | works in all variants (`textWidth=433`) | log |

What makes B fail was not isolated (B differs from C in `fontClass` vs `fontId`, `useOutlines`, and the local `DefineFont2`). Owner decision: the compiler emits variant A; C stays a documented alternative.

### Variant D final result (commit 970966f)

A first K run was invalid (a build bug made D ship the A-C probe script); fixed in 970966f, ignore that run. Verified with owner screenshot + `Inkwell.log`:
- `verticalAlign` WORKS: 'top', 'center', 'bottom' place text at the top, middle and bottom of a 200x150 box.
- `textAutoSize` WORKS: 'none' overflows and clips (maxscroll=3); 'shrink' and 'fit' render visibly smaller text that fits (textHeight 66 vs 106; maxscroll=1). `fontsize` stays 16, so shrink is a rendering scale. 'shrink' vs 'fit' looked identical on one sample, not isolated.
- `shadowStyle` NOT confirmed: property exists, 'shadow' reads back as "" and no shadow drawn. Eight numeric `shadow*` properties exist natively (`shadowColor`, `shadowAlpha`, `shadowBlurX`, `shadowBlurY`, `shadowAngle`, `shadowDistance`, `shadowStrength`, `shadowQuality`); `shadowParams`, `shadowOffsetX/Y`, `shadowBlur` do not. Text shadow stays unproven (needs other `shadowStyle` values or static filters).

### Measurement caveats (spike 1)

Cold (external wall clock, includes process spawn + JVM start) and warm (in-JVM timer around the build call only) are not like-for-like. All runs used identical inputs (hot file cache), cold samples are bimodal (4 runs 1.6-1.8 s, 6 runs 2.4-2.8 s), AV/power not controlled, bench used the variant-B skeleton and the pre-`cef78ff` probe source. "Cold > 1 s" holds either way; ~14 ms warm is a lower bound for a real round-trip. Warm output is SHA-256-identical to the CLI (re-checked by the reviewer). Nashorn (Java 8-14 only) wrapper is not shippable; ship a prebuilt jar.


## History: in-game run 1 (Skyrim SE 1.7.104, runtime-menu DLL spike)

Log: `LoadMovieEx returned true`, `_root exists: true`, `installed _root.inkwellTrace: true`. On screen: the dark-blue 1280x720 background shape, but **no text at all**, not even the placeholder `INKWELL SPIKE: AS2 NOT RUN`. So the SWF loads and renders shapes, but the TextField draws nothing. Run 1 cannot tell whether AS2 ran (the placeholder is invisible too, and the frame script ran before `_root.inkwellTrace` existed).

### Diagnosis (evidence: vanilla SWFs from `Skyrim - Interface.bsa`, read with FFDec `-swf2xml`, nothing committed)

Every vanilla menu text field checked (messagebox.swf 2/2, inventorymenu.swf 7/7, hudmenu.swf 19/20) uses this encoding, and none uses `fontClass`:

- `ImportAssets2 url="gfxfontlib.swf"` importing a font by name into a local character id, e.g. messagebox `7 = $EverywhereMediumFont`, inventorymenu `14 = $EverywhereMediumFont`, hudmenu `164 = $EverywhereMediumFont`, `439 = $DragonFont`;
- `DefineEditText hasFont=true fontId=<that id> hasFontClass=false useOutlines=true wasStatic=false readOnly=true html=true` (initial HTML `<font face="$EverywhereMediumFont" ...>`), usually followed by `CSMSettings`.

`gfxfontlib.swf` in the BSA does **not** export `$EverywhereMediumFont` or `$EverywhereFont` (its exports: `$MageScriptFont $SkyrimSymbolsFont $DaedricFont $DwemerFont $FalmerFont $DragonFont $StartMenuFont $DialogueTextFont $ConsoleFont $EverywhereBoldFont $SkyrimBooks $SkyrimBooks_Unreadable`). The import is resolved by GFx's font manager through `interface/fontconfig.txt` (`fontlib "Interfaceonts_en.swf"`, `map "$EverywhereFont" = "Futura CondensedLight" Normal`, `map "$EverywhereMediumFont" = "Futura Condensed" Normal`), i.e. the name lands in `fonts_en.swf`'s `DefineFont3` glyphs.

Our field had `useOutlines=false` (device font) and `HasFontClass` with `fontId=0`. Device text needs a system font provider, which Skyrim does not appear to install (all vanilla text is outline text), and `fontClass` is an AS3-era (SWF 9) field that GFx's AS2 path most likely ignores (worst case misparses). Either way no glyph source: nothing drawn, consistent with run 1. Confidence: high that the encoding is the cause (vanilla never uses ours, always uses A); medium on which of the two flags is the decisive one. Hypothesis "AS2 did not run" is not excluded by run 1; run 2 settles it via the log.

### History: variants for run 2 (`build.ps1` builds all three; same shape, same AS2 probes, only the report field's font encoding differs)

| Variant | File / hotkey | Report field font encoding |
| --- | --- | --- |
| A | `InkwellSpikeA.swf`, O (24) | exactly vanilla: `ImportAssets2 gfxfontlib.swf $EverywhereMediumFont` -> id 3, `fontId=3`, `useOutlines=true` |
| B | `InkwellSpikeB.swf`, P (25) | run-1 build: `fontClass=$EverywhereFont`, `fontId=0`, `useOutlines=false` (expected: invisible again) |
| C | `InkwellSpikeC.swf`, L (38) | no import: local zero-glyph `DefineFont2 "$EverywhereFont"` (id 3), `fontId=3`, `useOutlines=true` (GFx should substitute the glyph-less font by name via fontconfig) |

All variants additionally (AS2, unchanged probes plus):
- header line `INKWELL SPIKE 1+2 REPORT (v2) variant=X`; placeholder text `INKWELL SPIKE (font=import|class|define): AS2 NOT RUN`;
- probe e) `RUNTIMEFIELD`: a field made at runtime with `createTextField`, `embedFonts=true`, `TextFormat.font="$EverywhereFont"`, yellow, bottom-left at y=670: the no-SWF-font-tag route (what SkyUI-style code does);
- LOG: an `onEnterFrame` loop (installed before the probes, so it survives an AS2 crash mid-probe) polls `_root.inkwellTrace` each frame and, once it exists, sends every report line (also later ones) to `Inkwell.log`, then stops after `END` (or 300 frames; it gives up after 900 frames without the function).

### What to read back from `Documents\My Games\Skyrim Special Edition\SKSE\Inkwell.log`

Each line looks like `[AS2] inkwellTrace([InkwellSpike A] ...)`. Per variant:
- `LOG: inkwellTrace seen after N frame(s); lines=K` - present = AS2 runs (hypothesis 3 dead); absent = the frame script never ran.
- all report lines down to `END: all probes finished` and `LOG: done, sent K lines` (the full probe results for spike 2, even if nothing renders).
- `FONT: textWidth(20xW)=... textWidth(20xi)=...` - nonzero widths mean the report field's font resolved to glyphs; 0/0 means no glyph source (expected for B).
- `RUNTIMEFIELD: ... textWidth=...` - same question for the runtime-created field.
- On screen per variant: is the report visible (Y/N), is the yellow `RUNTIME FIELD X` line visible (Y/N), Skyrim's Futura glyphs (Y/N)?

Expected if the diagnosis holds: A visible in Skyrim's font; B invisible with textWidth 0; C and RUNTIMEFIELD visible if GFx maps glyph-less/embedFonts names through fontconfig (unknown; if they work, Inkwell can skip the import tag).

## Variant D (design; final result above): do the GFx TextField extensions CHANGE what is drawn? (`InkwellSpikeD.swf`, K = 37, `inkwell_spike_d.json`)

Run 2 only proved `verticalAlign`, `verticalAutoSize`, `textAutoSize`, `shadowStyle` exist as properties (read back, reject bogus values). D checks the visual effect. Font encoding = variant A (ImportAssets2 `gfxfontlib.swf` `$EverywhereMediumFont`, fontId, useOutlines, no fontClass) for every field, labels included. Sources: `gen-swf.mjs` layout `d` (the `BOXES` table), `src/as2-d/frame_1/DoAction.as`; `./build.ps1 -Only D -Deploy` (build.ps1 without `-Only` builds A-D).

Screen: dark blue 1280x720, all boxes have a 1px white border (`TextField.border`), a label line above each box names the setting, right half (x>=700) is an `info` field with the numbers (same lines go to `Inkwell.log` as `[InkwellSpike D] ...`).

| Row | Boxes (fixed size, same text each) | Extension WORKS | IGNORED |
| --- | --- | --- | --- |
| 1 `verticalAlign` | 3 boxes 200x150, text `Short text`: top / center / bottom | text hugs the top edge / sits in the middle / hugs the bottom edge | text is at the top in all three |
| 2 `textAutoSize` | 3 boxes 200x70 with 4 sentences of 16 px text, word wrap: none / shrink / fit | `none` overflows (clipped, `maxscroll`>1); `shrink` has smaller glyphs that fit inside the border; `fit` also fits (it may also grow small text, here the text is already too big) | all three look like `none` (clipped, same glyph size) |
| 3 `shadowStyle` | 3 boxes 200x60 on a grey background, white 28 px `Shadow`: no shadowStyle / `shadowStyle='shadow'` / `'shadow'` plus every numeric `shadow*` property that natively exists | boxes 2 and 3 show a dark drop shadow behind the glyphs, box 1 does not (box 3 may differ if the extra props exist) | all three identical |

Log numbers per box: `name: <prop>=<readback> | before w/h/maxscroll | after textWidth textHeight maxscroll _height _width fontsize`. Effective `textAutoSize` shrink/fit changes `fontsize` or `textWidth/textHeight` vs `none` and `maxscroll` goes to 1; effective `verticalAlign` leaves numbers unchanged (only the drawing differs). `SHADOWPROPS typeof before set` lists which guessed shadow parameter names (`shadowColor`, `shadowAlpha`, `shadowBlurX/Y`, `shadowAngle`, `shadowDistance`, `shadowStrength`, `shadowOffsetX/Y`, `shadowBlur`, `shadowParams`, `shadowQuality`) exist natively; the names are guesses (no GFx 3 docs available offline), `undefined` = not native.

Ruffle: not rendered. Ruffle cannot resolve the `gfxfontlib.swf` import (A-encoding renders blank there) and has no extensions, so it proves nothing. Static check only: `-header` (v10, 1280x720, FWS, 9326 bytes), `-dumpAS2`, 20 DefineEditText tags + the ImportAssets2.

## Questions

1. Can FFDec's CLI build a trivial SWF (one shape, one dynamic `$EverywhereFont` TextField, AS2 classes) from committed sources, and how long does that take cold (fresh JVM) vs warm (long-lived JVM)?
2. In Skyrim's GFx: does AS2 `try/catch/finally`, the GFx TextField extensions, and namespaced class registration work; what are Stage size and font resolution?

## What was built

- `gen-swf.mjs`: Node (no deps) emits a skeleton SWF v10, 1280x720: `SetBackgroundColor`, placeholder `DefineShape`, one `DefineEditText` (dynamic, ReadOnly, HasFont + fontClass `$EverywhereFont`, no embedded glyphs, instance name `report`), three empty exported sprites (`__Packages.mods.inkwellspike.Probe`, `__Packages.mods.other.Probe`, `InkwellProbeClip`) with placeholder `DoInitAction`s, empty frame `DoAction`. FFDec has no "new SWF" command, so this is the template.
- `src/shapes/1.svg`: the one shape (1280x720 background rect); `-importShapes` replaces character 1 (it keeps the old bounds, so the skeleton bounds already match).
- `src/as2/frame_1/DoAction.as`: all probes. `src/as2/__Packages/mods/{inkwellspike,other}/Probe.as`: the two classes. `-importScript` compiles them with FFDec's own AS2 compiler.
- `build.ps1`: reproduces `build/InkwellSpike{A,B,C}.swf` (font modes `import`/`class`/`define` of `gen-swf.mjs`, see run-2 variants above); each variant gets a copy of `src/as2` with `var VARIANT = "X";` prepended. `-Deploy` copies them to `C:\Modding\MO2\mods\Inkwell Spikes\Interface\` (an MO2 mod folder, never the game's Data) and removes the old `InkwellSpike.swf`. Menu JSONs (`inkwell_spike_{a,b,c}.json`, hotkeys O/P/L) live in that mod's `SKSE\Plugins\Inkwell\menus\`.
- `warm.js` + `bench.ps1`: warm-JVM wrapper and benchmark. `ruffle-sanity.png`: Ruffle render.

Run: `./build.ps1 [-Deploy]` (needs Node 22, FFDec at `C:\Program Files (x86)\FFDec`). Bench: `./bench.ps1 -Runs 10`. Warm wrapper alone:
`jjs -J-cp "<FFDec>\ffdec.jar;<FFDec>\lib\*" warm.js -- <base.swf> <shapesDir> <as2Dir> <out.swf> <runs>`, or `-- --stdin` with one job per line `base|shapesDir|as2Dir|out` (reply `OK <ms>`).

FFDec is only driven as a separate process / loaded from its install dir; nothing of it is in the repo.

## Measurements (FFDec 26.3.0, Temurin JRE 8u504, Windows 11; one machine, `bench.ps1`)

A full build = two FFDec operations (`-importShapes`, then `-importScript`).

| Mode | Runs | min ms | median ms | max ms | raw ms |
| --- | --- | --- | --- | --- | --- |
| COLD `ffdec-cli.exe` x2 (shapes+script, 2 JVMs) | 10 | 1640 | 2389 | 2767 | 1784,1640,1772,1686,2767,2383,2550,2395,2751,2516 |
| COLD `java -jar ffdec.jar` x2 | 10 | 1670 | 2581 | 2666 | 2607,2342,1732,1863,1670,2630,2595,2666,2624,2566 |
| COLD `ffdec-cli.exe` x1 (`-importScript` only) | 10 | 935 | 1339 | 1593 | 1427,1448,1278,1593,1401,1450,1261,1038,941,935 |
| WARM first job in a new JVM (Nashorn + ffdec_lib, in-process: shapes+script+write) | 1 | 569 | 569 | 569 | 569 |
| WARM jobs 2..30, same JVM | 29 | 8 | 14 | 29 | 29,20,26,14,18,14,12,14,14,12,11,12,9,15,14,9,15,13,14,13,10,8,13,8,13,13,18,19,17 |
| WARM jobs 11..30 (JIT warmed) | 20 | 8 | 13 | 19 | 12,11,12,9,15,14,9,15,13,14,13,10,8,13,8,13,13,18,19,17 |

Earlier runs of the same bench gave warm medians of 14-18 ms and cold x2 medians of 2.3-2.7 s (run-to-run noise about 15%). One `jjs` process for a single job, including JVM and Nashorn start, took about 1.7 s, so warm only pays off with a resident process. The `--stdin` protocol was exercised with 5 jobs (`OK 565, 19.8, 69.9, 29.0, 18.4` ms). Warm output is byte-identical (SHA-256) to the CLI output.

Reading: cold FFDec is about 2.4 s per build, far over the 1 s target; a resident JVM brings the compile step to about 15 ms. The warm wrapper is Nashorn calling `SWF`, `SvgImporter.importSvg`, `AS2ScriptImporter.importScripts`, `SWF.saveTo` (no javac needed). Calling `CommandLineArgumentParser.parseArguments` in a loop does NOT work: it ends in `System.exit`, and a SecurityManager guard via Nashorn deadlocks the JVM.

## Static verification (done)

- `ffdec-cli -dumpSWF`: no errors; tags SetBackgroundColor, DefineShape, DefineEditText, 3x DefineSprite, ExportAssets, 2x DoInitAction, PlaceObject2 x2 (instance `report`), DoAction, ShowFrame.
- `-dumpAS2`: `__Packages\mods.inkwellspike\Probe`, `__Packages\mods.other\Probe`, `frame 1 - DoAction`. `-header`: version=10, 1280x720 px, 30 fps, uncompressed FWS. `-export script` decompiles all three back to source; class bytecode is the standard Flash `_global.mods.x.Probe` + `ASSetPropFlags` pattern; `try` emits `ActionTry`.
- `-swf2xml`: `DefineEditTextTag fontClass="$EverywhereFont" hasFont hasFontClass wasStatic=false readOnly=true useOutlines=false`.
- FFDec AS2 parser quirk: it rejects return-type annotations (`function f():String`), so sources omit them. `var x:Type` is accepted.

## Ruffle sanity (done; Ruffle is not GFx)

`@ruffle-rs/ruffle` 0.7.1 (npm) in headless Edge renders the SWF (`ruffle-sanity.png`, now variant C; B renders identically, A stays blank in Ruffle because it cannot resolve the `gfxfontlib.swf` import, which proves nothing about GFx). Ruffle falls back to a system font for every encoding, so it cannot validate fonts. Run-1 notes: Per probe: ALIVE ok; STAGE 1280x720; TRYCATCH OK (`str=boom err=err1 isError=true fin=11 fin2=11 nested=c1:inner c2:re-inner`); every GFx extension line shows `base=undefined ... bogus->bogus native=false` (expected: Ruffle has none, and TextField is dynamic so assignment echoes); FILTERS DropShadow set ok; CLASS no-collision=true; REGISTERCLASS true / attachMovie true / isProbe=true; FONT reports `$EverywhereFont` (just the format name, not proof of resolution), type=dynamic.

## Result per probe

| Probe | Ruffle | In-game (GFx) |
| --- | --- | --- |
| a) try/catch/finally | OK (and `Error` exists) | PASS for explicit throws; no `Error` class |
| b) GFx TextField extensions | not native (expected) | present as properties; `verticalAlign`, `textAutoSize` visually verified (variant D); `shadowStyle` not confirmed; `autoShrink` absent |
| c) classes / namespaces / registerClass | OK | PASS (custom-menu movie) |
| d) Stage, version, `$EverywhereFont` | 1280x720, `LNX 32,0,0,0` | `WIN 8,0,0,0`; fonts per variants A/C ok, B blank |
| Spike 1: SWF loads in Skyrim SE | n/a | PASS |

How to judge the extension lines in-game: `read=set` alone proves nothing (the EXT-CONTROL line shows unknown properties echo). A **native** GFx property has `base` defined before being set (e.g. `base=top`), rejects a bogus value (`bogus->top`), and prints `native=true`.

## On-screen report the human should read back

Top-left, 16 px, light text on a dark blue 1280x720 background. Lines in order (read them back verbatim, everything after the colon matters):
`INKWELL SPIKE 1+2 REPORT (v2) variant=X`, `ALIVE`, `STAGE`, `VERSION`, `VERSION2`, `GLOBALS`, `TRYCATCH`, `EXT-CONTROL`, `VALIGN`, `VAUTOSIZE`, `AUTOSHRINK`, `TEXTAUTOSIZE`, `SHADOWSTYLE`, `NOTRANSLATE`, `FILTERS` (2 lines), `CLASS` (4 lines), `REGISTERCLASS`, `FONT` (3 lines), `RUNTIMEFIELD`, `END: all probes finished`. The same lines are in `Inkwell.log` (see above).

Text is refreshed after every probe, so if the AS2 dies partway, the last line shown says where. Initial text `INKWELL SPIKE (font=...): AS2 NOT RUN` means the SWF loaded but the frame script never ran. Nothing on screen means the text field did not draw (run 1); then the log is the evidence. Also answer visually: does the glyph style match Skyrim's menu font (Y/N), and is the dark-blue 1280x720 background visible and aligned?

## In-game path

Only via the Inkwell Runtime DLL spike, which should open `Interface/InkwellSpike{A,B,C}.swf` as custom menus (the SWF needs no engine/SKSE functions; frame 1 runs everything; it uses `this._lockroot`). Overwriting vanilla SWFs is not allowed, so there is no DLL-free test. The test files are deployed to `C:\Modding\MO2\mods\Inkwell Spikes\Interface\InkwellSpike{A,B,C}.swf`. `trace()` output only appears in the Scaleform log if enabled.

## Risks

- Confirmed in run 1 and log-confirmed in run 2 (variant B): `fontClass` + device text draws nothing in Skyrim's GFx. Inkwell output must use outline text with a font GFx can resolve (variant A's encoding is the vanilla one).
- SWF v10 loads in Skyrim SE 1.7.104 (verified in-game); other game builds untested.
- The warm path uses FFDec internal classes (`SvgImporter`, `AS2ScriptImporter`), unstable across FFDec versions; pin and verify the version.
- Warm timing excludes preview and the SVG complexity of real designs.
