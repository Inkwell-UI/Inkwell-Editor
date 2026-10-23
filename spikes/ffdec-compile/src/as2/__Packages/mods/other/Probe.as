class mods.other.Probe
{
    static var COUNT:Number = 100;
    var tag:String = "other";

    function Probe()
    {
        mods.other.Probe.COUNT++;
    }

    function who()
    {
        return "mods.other.Probe";
    }
}
