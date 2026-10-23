class mods.inkwellspike.Probe extends MovieClip
{
    static var COUNT:Number = 0;
    var tag:String = "inkwellspike";

    function Probe()
    {
        mods.inkwellspike.Probe.COUNT++;
    }

    function who()
    {
        return "mods.inkwellspike.Probe";
    }
}
