// Inkwell spike 1+2 probes. Self-contained: no engine/SKSE functions required.
// Evidence: the on-screen report TextField AND Inkwell.log (lines are sent to _root.inkwellTrace, see LOG below).
// build.ps1 prepends `var VARIANT = "A";` (A/B/C = font encoding of the report field, see README).
stop();
this._lockroot = true;
_global.gfxExtensions = true;

var lines:Array = [];
// the helper functions below run with `this` = the timeline, so keep a handle
var tl = this;
function say(s:String)
{
    lines.push(s);
    trace("[InkwellSpike] " + s);
    tl.report.text = lines.join("\n");
}

// ---- LOG: the runtime DLL installs _root.inkwellTrace only after LoadMovieEx returns, i.e. after
// this frame ran, so poll for it every frame and send every report line (also lines added later).
var P:String = "[InkwellSpike " + VARIANT + "] ";
var sent:Number = 0;
var waited:Number = 0;
this.onEnterFrame = function()
{
    waited++;
    if (_root.inkwellTrace == undefined) {
        if (waited > 900) delete this.onEnterFrame;
        return;
    }
    if (sent == 0) _root.inkwellTrace(P + "LOG: inkwellTrace seen after " + waited + " frame(s); lines=" + lines.length);
    while (sent < lines.length) _root.inkwellTrace(P + lines[sent++]);
    if (lines[lines.length - 1].indexOf("END") == 0 || waited > 300) {
        _root.inkwellTrace(P + "LOG: done, sent " + sent + " lines");
        delete this.onEnterFrame;
    }
};

var tf:TextField = this.report;
say("INKWELL SPIKE 1+2 REPORT (v2) variant=" + VARIANT);
say("ALIVE: AS2 frame script ran; tf=" + (tf != undefined));

// ---- d) environment ----
try {
    say("STAGE: " + Stage.width + "x" + Stage.height + " scaleMode=" + Stage.scaleMode + " align=[" + Stage.align + "]");
    say("VERSION: getVersion=" + getVersion() + " | caps.version=" + System.capabilities.version);
    say("VERSION2: $version=" + this.$version + " os=" + System.capabilities.os + " lang=" + System.capabilities.language);
    say("GLOBALS: gfxExtensions=" + _global.gfxExtensions + " typeof gfx=" + typeof _global.gfx + " typeof skse=" + typeof _global.skse + " typeof Error=" + typeof Error + " typeof Object.registerClass=" + typeof Object.registerClass);
} catch (eEnv) {
    say("ENV: FAIL " + eEnv);
}

// ---- a) try / catch / finally ----
var tc_ok:Boolean = true;
var tc:String = "";
try {
    try { throw "boom"; } catch (e1) { tc += "str=" + e1; }
    try { throw new Error("err1"); } catch (e2) { tc += " err=" + e2.message + " isError=" + (e2 instanceof Error); }
    var fin:Number = 0;
    try { fin = 1; } finally { fin += 10; }
    var fin2:Number = 0;
    try { throw "x"; } catch (e3) { fin2 = 1; } finally { fin2 += 10; }
    tc += " fin=" + fin + " fin2=" + fin2;
    var nested:String = "";
    try {
        try { throw "inner"; } catch (e4) { nested += "c1:" + e4; throw "re-" + e4; }
    } catch (e5) { nested += " c2:" + e5; }
    tc += " nested=" + nested;
    tc_ok = (fin == 11 && fin2 == 11 && nested == "c1:inner c2:re-inner");
} catch (eTc) {
    tc_ok = false;
    tc += " OUTER-CATCH " + eTc;
}
say("TRYCATCH: " + (tc_ok ? "OK" : "FAIL") + " " + tc);

// ---- b) GFx TextField extensions ----
function ext(label:String, prop:String, val, bogus)
{
    var base = tf[prop];
    tf[prop] = val;
    var rd = tf[prop];
    var bog = "-";
    if (bogus != undefined) {
        tf[prop] = bogus;
        bog = String(tf[prop]);
        tf[prop] = val;
    }
    // native: property existed before we set it. echo-only (plain Flash) shows base=undefined.
    say(label + ": base=" + base + " set=" + val + " read=" + rd + " bogus->" + bog + " native=" + (base !== undefined));
}
tf._ctl_dummy = "x";
say("EXT-CONTROL: unknown prop echoes=" + (tf._ctl_dummy == "x") + " (so 'read=set' alone proves nothing; look at base/bogus/native)");
ext("VALIGN", "verticalAlign", "center", "bogus");
ext("VAUTOSIZE", "verticalAutoSize", "center", "bogus");
ext("AUTOSHRINK", "autoShrink", "shrink", "bogus");
ext("TEXTAUTOSIZE", "textAutoSize", "shrink", "bogus");
ext("SHADOWSTYLE", "shadowStyle", "shadow", "bogus");
ext("NOTRANSLATE", "noTranslate", true, undefined);
say("FILTERS: typeof flash.filters.DropShadowFilter=" + typeof flash.filters.DropShadowFilter + " tf.filters=" + typeof tf.filters);
try {
    var df = new flash.filters.DropShadowFilter(2, 45, 0x000000, 1, 2, 2, 1, 1);
    tf.filters = [df];
    say("FILTERS: set -> length=" + tf.filters.length);
} catch (eF) {
    say("FILTERS: threw " + eF);
}
tf.verticalAlign = "top"; // restore so the report stays readable

// ---- c) class registration / namespaces ----
try {
    var p1 = new mods.inkwellspike.Probe();
    var p2 = new mods.other.Probe();
    say("CLASS: p1=" + p1.who() + " p2=" + p2.who());
    say("CLASS: tags=" + p1.tag + "/" + p2.tag + " counts=" + mods.inkwellspike.Probe.COUNT + "/" + mods.other.Probe.COUNT);
    say("CLASS: instanceof p1=" + (p1 instanceof mods.inkwellspike.Probe) + " p1-as-other=" + (p1 instanceof mods.other.Probe) + " p2-as-inkwell=" + (p2 instanceof mods.inkwellspike.Probe));
    say("CLASS: no-collision=" + (p1.who() != p2.who() && p1.tag != p2.tag && mods.inkwellspike.Probe.COUNT == 1 && mods.other.Probe.COUNT == 101));
    var rc:Boolean = Object.registerClass("InkwellProbeClip", mods.inkwellspike.Probe);
    var pc = this.attachMovie("InkwellProbeClip", "pc", 5);
    say("REGISTERCLASS: registerClass=" + rc + " attachMovie=" + (pc != undefined) + " who=" + pc.who() + " isProbe=" + (pc instanceof mods.inkwellspike.Probe));
} catch (eC) {
    say("CLASS: FAIL " + eC);
}

// ---- d) font resolution ----
try {
    var fmt:TextFormat = tf.getTextFormat();
    say("FONT: tf.getTextFormat().font=" + fmt.font + " size=" + fmt.size + " embedFonts=" + tf.embedFonts + " type=" + tf.type);
    var saved:String = tf.text;
    tf.text = "WWWWWWWWWWWWWWWWWWWW";
    var wW:Number = tf.textWidth;
    tf.text = "iiiiiiiiiiiiiiiiiiii";
    var wI:Number = tf.textWidth;
    tf.text = saved;
    say("FONT: textWidth(20xW)=" + wW + " textWidth(20xi)=" + wI + " ratio=" + Math.round(100 * wW / wI) / 100 + " (>1.5 = proportional)");
    say("FONT: LOOK AT THE GLYPHS: does this text use Skyrim's menu font? (Y/N)");
} catch (eFt) {
    say("FONT: FAIL " + eFt);
}
// ---- e) runtime-created field: no SWF font tag at all, font only via embedFonts + fontconfig name ----
try {
    var rt = this.createTextField("rt", 20, 40, 670, 1200, 40);
    if (rt == undefined) rt = this.rt;
    var rf:TextFormat = new TextFormat();
    rf.font = "$EverywhereFont";
    rf.size = 20;
    rf.color = 0xFFFF80;
    rt.embedFonts = true;
    rt.setNewTextFormat(rf);
    rt.text = "RUNTIME FIELD " + VARIANT + ": createTextField embedFonts=true font=$EverywhereFont";
    say("RUNTIMEFIELD: created=" + (rt != undefined) + " embedFonts=" + rt.embedFonts + " font=" + rt.getTextFormat().font + " textWidth=" + rt.textWidth + " (0 = no glyphs)");
} catch (eRt) {
    say("RUNTIMEFIELD: FAIL " + eRt);
}
say("END: all probes finished");
