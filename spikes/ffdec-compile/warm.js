// Warm-JVM build wrapper around ffdec_lib (Nashorn on a JRE-only install; no javac needed).
//   jjs -J-cp "<FFDec>\ffdec.jar;<FFDec>\lib\*" warm.js -- <base.swf> <shapesDir> <as2Dir> <out.swf> <runs>
//   jjs ... warm.js -- --stdin      job per line "base|shapesDir|as2Dir|out" -> reply "OK <ms>" / "ERR <msg>"
// One job = what build.ps1 does with two ffdec-cli calls, but in-process: parse base SWF, SVG->shape, AS2 compile, write.
var SWF = Java.type('com.jpexs.decompiler.flash.SWF');
var Svg = Java.type('com.jpexs.decompiler.flash.importers.svg.SvgImporter');
var As2 = Java.type('com.jpexs.decompiler.flash.importers.AS2ScriptImporter');
var Files = Java.type('java.nio.file.Files'), File = Java.type('java.io.File');
var FOS = Java.type('java.io.FileOutputStream'), FIS = Java.type('java.io.FileInputStream');
var Str = Java.type('java.lang.String'), System = Java.type('java.lang.System');

function build(base, shapes, as2, out) {
  var swf = new SWF(new FIS(base), false);
  Java.from(new File(shapes).listFiles()).forEach(function (f) {
    var id = parseInt(String(f.getName()).replace('.svg', ''));
    new Svg().importSvg(swf.getCharacter(id), new Str(Files.readAllBytes(f.toPath()), 'UTF-8'), true);
  });
  var n = new As2().importScripts(as2, swf.getASMs(true));
  var os = new FOS(out); swf.saveTo(os); os.close();
  return n;
}
if (arguments[0] === '--stdin') {
  var r = new (Java.type('java.io.BufferedReader'))(new (Java.type('java.io.InputStreamReader'))(System['in'])), line;
  while ((line = r.readLine()) !== null) {
    var f = String(line).split('|'), t = System.nanoTime();
    try { build(f[0], f[1], f[2], f[3]); print('OK ' + ((System.nanoTime() - t) / 1e6).toFixed(1)); } catch (e) { print('ERR ' + e); }
  }
} else {
  var runs = parseInt(arguments[4]);
  for (var i = 1; i <= runs; i++) {
    var t = System.nanoTime(), n = build(arguments[0], arguments[1], arguments[2], arguments[3]);
    print('run ' + i + ' ms=' + ((System.nanoTime() - t) / 1e6).toFixed(1) + ' scripts=' + n);
  }
}
