// Inkwell spike widget: root holds clip `widget` (SkyUI WidgetLoader requires holder.widget); SkyUI calls its methods via UI.Invoke*.
// Minimal own-words re-implementation of skyui.widgets.WidgetBase for the calls the Papyrus side makes.
var w = widget;
w._label = "";
w._hAnchor = "left";
w._vAnchor = "top";
w._px = 0;
w._py = 0;
w.log = function (s) {
	try { if (typeof (_global.skse) == "object" && _global.skse.Log != undefined) { _global.skse.Log("[Inkwell] " + s); } } catch (e) {}
};
w.lerp = function (a, b, c, d, v) { return c + (d - c) * (v - a) / (b - a); };
w.updatePosition = function () {
	var m = this._hudMetrics;
	var h = this._parent;
	var x = this._px;
	var y = this._py;
	if (m != undefined) {
		x = this.lerp(-m.hMin, m.hMax, 0, 1280, x);
		y = this.lerp(-m.vMin, m.vMax, 0, 720, y);
	}
	// anchor: shift the holder like WidgetBase.updateAnchor, then place the widget clip
	h._x = this._hAnchor == "right" ? -this._width : (this._hAnchor == "center" ? -this._width / 2 : 0);
	h._y = this._vAnchor == "bottom" ? -this._height : (this._vAnchor == "center" ? -this._height / 2 : 0);
	this._x = x;
	this._y = y;
};
w.setHudMetrics = function (m) { this._hudMetrics = m; this.log("setHudMetrics"); };
w.setRootPath = function (p) { this._rootPath = p; this.log("setRootPath " + p); };
w.setClientInfo = function (s) { this._clientInfo = s; };
w.setModes = function () { this._parent._visible = true; this.log("setModes"); };
w.onModeChange = function (m) { this._mode = m; };
w.setHAnchor = function (a) { this._hAnchor = a.toLowerCase(); this.updatePosition(); };
w.setVAnchor = function (a) { this._vAnchor = a.toLowerCase(); this.updatePosition(); };
w.setPositionX = function (v) { this._px = v; this.updatePosition(); };
w.setPositionY = function (v) { this._py = v; this.updatePosition(); };
w.setAlpha = function (a) { this._alpha = a; };
w.setLabel = function (s) { this._label = s; this.label.text = s; this.log("setLabel " + s); };
if (_global.gfxPlayer) { _global.gfxExtensions = true; }
