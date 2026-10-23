;; original stub, not a Bethesda/SkyUI file. Written from scratch for the Inkwell compiler spike; declarations only (signatures from public API knowledge).
Scriptname ScriptObject Native Hidden
Function RegisterForModEvent(string eventName, string callbackName) native
Function UnregisterForModEvent(string eventName) native
Function RegisterForSingleUpdate(float afInterval) native
Function UnregisterForUpdate() native
Function SendModEvent(string eventName, string strArg = "", float numArg = 0.0) native
