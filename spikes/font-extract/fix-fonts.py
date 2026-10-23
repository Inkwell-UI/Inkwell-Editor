"""Post-process FFDec TTF exports: licence gate, rename to Inkwell/Figma scheme, normalise metrics.
usage: python -I fix-fonts.py <rawdir> <outdir>   (needs fonttools)"""
import sys, glob, json, os
from fontTools.ttLib import TTFont

# raw name1 (+bold) -> (family, style, aliases it serves). Aliases per Interface/fontconfig.txt (v1.7.104).
SCHEME = {
    ("Futura CondensedLight", False): ("Everywhere", "Light", 300, ["$EverywhereFont", "$DialogueFont"]),
    ("Futura Condensed", False): ("Everywhere", "Medium", 500, ["$EverywhereMediumFont", "$StartMenuFont"]),
    ("Futura Condensed", True): ("Everywhere", "Bold", 700, ["$EverywhereBoldFont"]),
    ("Dragon_script", False): ("Dragon", "Regular", 400, ["$DragonFont"]),
    ("SkyrimBooks_Handwritten_Bold", False): ("Handwritten", "Regular", 400, ["$HandwrittenFont", "$HandwrittenBold"]),
    ("SkyrimBooks_Gaelic", False): ("SkyrimBooks", "Regular", 400, ["$SkyrimBooks"]),
    ("Falmer", False): ("Falmer", "Regular", 400, ["$FalmerFont"]),
    ("Dwemer", False): ("Dwemer", "Regular", 400, ["$DwemerFont"]),
    ("Daedric", False): ("Daedric", "Regular", 400, ["$DaedricFont"]),
    ("Mage Script", False): ("MageScript", "Regular", 400, ["$MageScriptFont"]),
    ("SkyrimSymbols", False): ("SkyrimSymbols", "Regular", 400, ["$SkyrimSymbolsFont"]),
}
NOTICE = ("These fonts were extracted from your own copy of Skyrim. They remain the property of Bethesda Softworks and, "
          "for Everywhere (Futura Condensed), of Adobe/Linotype/Neufville. They are installed for your account only, for "
          "designing Skyrim UI in Figma. Do not redistribute, upload or ship them. Remove them any time with the uninstall tool.")
FSTYPE_NAMES = {0: "installable", 2: "restricted licence", 4: "preview & print", 8: "editable"}

def fstype_label(v):
    if v & 0x2: return "restricted"
    if v & 0x4: return "preview-print"
    if v & 0x8: return "editable"
    return "installable"

def main(raw, out):
    os.makedirs(out, exist_ok=True)
    made, skipped = [], []
    for p in sorted(glob.glob(os.path.join(raw, "*.ttf"))):
        f = TTFont(p)
        n1 = f["name"].getDebugName(1)
        bold = bool(f["head"].macStyle & 1)
        spec = SCHEME.get((n1, bold))
        if not spec:
            skipped.append(os.path.basename(p)); continue
        fam, sty, wt, aliases = spec
        fs = f["OS/2"].fsType
        if fs & 0x2:  # the one flag that forbids installing; never reached with FFDec output (see README)
            sys.exit(f"REFUSING: {n1} has fsType={fs} (restricted licence embedding). Not installing.\n{NOTICE}")
        cop = (f["name"].getDebugName(0) or "").replace("\ufffd", "(c)").split(", FFDec")[0].strip()
        full, ps = (fam if sty == "Regular" else f"{fam} {sty}"), f"{fam}-{sty}"
        nm = f["name"]; nm.names = []
        for i, s in {0: cop, 1: full, 2: "Regular", 3: f"Inkwell extract: {ps}", 4: full, 5: "Version 1.0", 6: ps,
                     13: "Extracted from the user's own Skyrim install for personal design use. Not redistributable. See Skyrim EULA.",
                     16: fam, 17: sty}.items():
            nm.setName(s, i, 3, 1, 0x409)
        o2 = f["OS/2"]; o2.version = max(o2.version, 4); o2.usWeightClass = wt; o2.fsSelection = 0x40 | 0x80  # REGULAR | USE_TYPO_METRICS
        f["head"].macStyle = 0
        h = f["hhea"]; h.lineGap = 0; o2.sTypoLineGap = 0
        o2.sTypoAscender, o2.sTypoDescender = h.ascent, h.descent
        o2.usWinAscent, o2.usWinDescent = h.ascent, -h.descent
        if "hdmx" in f: del f["hdmx"]
        fn = f"{ps}.ttf"; f.save(os.path.join(out, fn))
        made.append({"file": fn, "family": fam, "style": sty, "psName": ps, "aliases": aliases, "fsType": fs,
                     "fsTypeMeaning": fstype_label(fs), "glyphs": f["maxp"].numGlyphs, "unitsPerEm": f["head"].unitsPerEm})
    json.dump({"notice": NOTICE, "fonts": made}, open(os.path.join(out, "fonts.json"), "w"), indent=1)
    print(NOTICE)
    for m in made: print(f"  {m['family']}/{m['style']:8} {m['file']:34} glyphs={m['glyphs']:4} fsType={m['fsType']} ({m['fsTypeMeaning']}) <- {', '.join(m['aliases'])}")
    print("skipped (not in scheme):", ", ".join(skipped))
    # self-check: the editor convention family/style -> alias for Everywhere
    assert {(m["family"], m["style"]) for m in made} >= {("Everywhere", s) for s in ("Light", "Medium", "Bold")}, "Everywhere faces missing"

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
