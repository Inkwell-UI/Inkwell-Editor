;; original stub, not a Bethesda/SkyUI file. Written from scratch for Inkwell; declarations only (signatures from public API knowledge).
Scriptname Form extends ScriptObject Native Hidden
Event OnInit()
EndEvent
Event OnUpdate()
EndEvent
Function RegisterForKey(int keyCode) native
Function UnregisterForKey(int keyCode) native
Function UnregisterForAllKeys() native
Event OnKeyDown(int keyCode)
EndEvent
