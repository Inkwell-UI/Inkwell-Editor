// Inkwell spike widget: minimal re-implementation (own words) of the root-timeline API that SkyUI's widget manager calls via UI.Invoke*.
// SkyUI loads this SWF into _root.WidgetContainer.<id>.widget, so _parent is the holder clip.
var holder = this._parent;
var hAnchor = "left";
var vAnchor = "top";
var px = 0;
var py = 0;
function place() {
	var w = this._width;
	var h = this._height;
	// positions are in 1280x720 space; the HUD-metrics correction SkyUI applies is intentionally omitted in this spike
	holder._x = px - (hAnchor == "right" ? w : (hAnchor == "center" ? w / 2 : 0));
	holder._y = py - (vAnchor == "bottom" ? h : (vAnchor == "center" ? h / 2 : 0));
}
function setRootPath(p) {}
function setHudMetrics(m) {}
function setClientInfo(s) {}
function setModes() { holder._visible = true; }
function setHAnchor(a) { hAnchor = a.toLowerCase(); place(); }
function setVAnchor(a) { vAnchor = a.toLowerCase(); place(); }
function setPositionX(v) { px = v; place(); }
function setPositionY(v) { py = v; place(); }
function setAlpha(a) { this._alpha = a; }
function setLabel(s) { label.text = s; }
if (_global.gfxPlayer) { _global.gfxExtensions = true; }
