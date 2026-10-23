// Spike 8: Skyrim BSA -> fonts_en.swf -> FFDec TTF export -> fix-fonts.py -> out/fonts. Writes only under out/.
// Run: ..\bsa-reader\node_modules\.bin\tsx extract-fonts.ts [--game <Skyrim dir>] [--ffdec <ffdec-cli.exe>] [--python <python.exe>]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { open, extract } from "../bsa-reader/bsa.js";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const game = arg("--game", "D:/SteamLibrary/steamapps/common/Skyrim Special Edition");
const ffdec = arg("--ffdec", process.env.INKWELL_FFDEC ?? "C:/Program Files (x86)/FFDec/ffdec-cli.exe");
const python = arg("--python", process.env.INKWELL_FONT_PYTHON ?? "C:/dev/venv-fonts/Scripts/python.exe"); // needs `pip install fonttools`
const out = join(import.meta.dirname, "out");
const work = join(out, "work");

const bsaPath = join(game, "Data", "Skyrim - Interface.bsa");
if (existsSync(join(game, "Data", "Interface", "fonts_en.swf"))) console.warn("note: a loose Data/Interface/fonts_en.swf exists and overrides the BSA in game; this tool reads the BSA copy.");
const bsa = open(bsaPath);
const e = bsa.entries.find((x) => `${x.folder}/${x.name}`.toLowerCase() === "interface/fonts_en.swf");
if (!e) throw new Error("interface/fonts_en.swf not in " + bsaPath);

rmSync(out, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const swf = join(work, "fonts_en.swf");
writeFileSync(swf, extract(bsa, e));
execFileSync(ffdec, ["-format", "font:ttf", "-export", "font", join(work, "raw"), swf], { stdio: "inherit" });
execFileSync(python, ["-I", join(import.meta.dirname, "fix-fonts.py"), join(work, "raw"), join(out, "fonts")], { stdio: "inherit" });
