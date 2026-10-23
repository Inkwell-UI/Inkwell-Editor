;; original stub, not a Bethesda/SkyUI file. Written from scratch for Inkwell; declarations only (signatures from public API knowledge).
Scriptname SKI_WidgetBase extends SKI_QuestBase

string property WidgetName auto
string property HAnchor
	string Function get()
		return ""
	EndFunction
	Function set(string a_val)
	EndFunction
EndProperty
string property VAnchor
	string Function get()
		return ""
	EndFunction
	Function set(string a_val)
	EndFunction
EndProperty
float property X
	float Function get()
		return 0.0
	EndFunction
	Function set(float a_val)
	EndFunction
EndProperty
float property Y
	float Function get()
		return 0.0
	EndFunction
	Function set(float a_val)
	EndFunction
EndProperty
float property Alpha
	float Function get()
		return 0.0
	EndFunction
	Function set(float a_val)
	EndFunction
EndProperty
string[] property Modes auto
int property WidgetID
	int Function get()
		return 0
	EndFunction
EndProperty
bool property Ready
	bool Function get()
		return false
	EndFunction
EndProperty
string property WidgetRoot
	string Function get()
		return ""
	EndFunction
EndProperty

Event OnWidgetInit()
EndEvent
Event OnWidgetLoad()
EndEvent
Event OnWidgetReset()
EndEvent
string Function GetWidgetSource()
	return ""
EndFunction
string Function GetWidgetType()
	return ""
EndFunction
float[] Function GetDimensions()
	return new float[2]
EndFunction
Function TweenToX(float a_x, float a_duration)
EndFunction
Function TweenToY(float a_y, float a_duration)
EndFunction
Function TweenTo(float a_x, float a_y, float a_duration)
EndFunction
Function FadeTo(float a_alpha, float a_duration)
EndFunction
bool property RequireExtend auto
bool Function IsExtending()
	return true
EndFunction
