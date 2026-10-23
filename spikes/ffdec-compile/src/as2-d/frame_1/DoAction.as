// Inkwell spike D: do the GFx TextField extensions CHANGE what is drawn? Boxes are created by gen-swf.mjs (layout 'd').
// build.ps1 prepends `var VARIANT = "D";`. Numbers go to the on-screen `info` field and to _root.inkwellTrace (Inkwell.log).
stop();
this._lockroot = true;
_global.gfxExtensions = true;

var lines:Array = [];
var tl = this;
function say(s:String)
{
    lines.push(s);
    tl.info.text = lines.join("\n");
}

// poll for _root.inkwellTrace (installed by the DLL after this frame ran), same loop as variants A-C
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

say("INKWELL SPIKE D variant=" + VARIANT + " (visual: compare boxes with README)");

// apply props (name/value pairs in arrays) to the box, then report what a native, effective setting would change
function box(name:String, props:Array)
{
    var t:TextField = tl[name];
    try {
        t.border = true;
        t.borderColor = 0xFFFFFF;
        var before = "w=" + t.textWidth + " h=" + t.textHeight + " ms=" + t.maxscroll;
        var rb = "";
        for (var i = 0; i < props.length; i += 2) {
            t[props[i]] = props[i + 1];
            rb += " " + props[i] + "=" + t[props[i]];
        }
        say(name + ":" + rb + " | before " + before + " | after textWidth=" + t.textWidth + " textHeight=" + t.textHeight
            + " maxscroll=" + t.maxscroll + " _height=" + t._height + " _width=" + t._width + " fontsize=" + t.getTextFormat().size);
    } catch (e) {
        say(name + ": FAIL " + e);
    }
}

box("v_top", ["verticalAlign", "top"]);
box("v_center", ["verticalAlign", "center"]);
box("v_bottom", ["verticalAlign", "bottom"]);
box("a_none", ["textAutoSize", "none"]);
box("a_shrink", ["textAutoSize", "shrink"]);
box("a_fit", ["textAutoSize", "fit"]);

// shadow: light-grey background + white text so a dark shadow is visible
var sn:Array = ["s_none", "s_shadow", "s_params"];
for (var k = 0; k < 3; k++) {
    var st:TextField = tl[sn[k]];
    st.background = true;
    st.backgroundColor = 0x8899AA;
    st.textColor = 0xFFFFFF;
}
box("s_none", []);
box("s_shadow", ["shadowStyle", "shadow"]);
// candidate shadow parameter properties (unverified names); numeric ones that already exist (native) get a strong value
var cand:Array = ["shadowColor", "shadowAlpha", "shadowBlurX", "shadowBlurY", "shadowAngle", "shadowDistance", "shadowStrength",
                  "shadowOffsetX", "shadowOffsetY", "shadowBlur", "shadowParams", "shadowQuality"];
var sp:TextField = tl.s_params;
var found:String = "";
sp.shadowStyle = "shadow";
for (var c = 0; c < cand.length; c++) {
    var tp:String = typeof sp[cand[c]];
    found += " " + cand[c] + "=" + tp;
    if (tp == "number") {
        sp[cand[c]] = (cand[c] == "shadowColor") ? 0x000000 : (cand[c] == "shadowAlpha" ? 1 : 6);
    }
}
say("SHADOWPROPS typeof before set:" + found);
box("s_params", ["shadowStyle", "shadow"]);
say("END: all boxes finished");
