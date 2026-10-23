# FFDec wrapper

`tools/ffdec-wrapper/` is a small Java program (`com.inkwell.Wrapper`) that keeps FFDec's library loaded and builds SWFs on request. The editor client is `src/main/build/ffdecWrapper.ts`.

- FFDec is user-installed (config: FFDec dir, default `C:\Program Files (x86)\FFDec`). The jar contains none of it; it is started as `java -cp ffdec-wrapper.jar;<FFDec>\lib\ffdec_lib.jar;<FFDec>\lib\* com.inkwell.Wrapper` on the user's Java (8+).
- Pinned to FFDec `26.3.0` (constant `PINNED`). The `ready` line reports `{ffdec, pinned, match}`; on a mismatch every job fails with an explanatory error.
- Build: `yarn build:wrapper` needs a JDK (default `C:\dev\jdk`, override `INKWELL_JDK`), compiles with `--release 8`, writes `tools/ffdec-wrapper/build/ffdec-wrapper.jar` (git-ignored).

## Protocol (one JSON object per line)

- In: `{"id","base","shapes"?,"scripts"?,"out"}` or `{"cmd":"cancel","id"}`.
- Out: `{"ready":true,"ffdec","pinned","match"}` once, then `{"id","ok","ms","error"?}`. A cancelled queued job replies `{"id","ok":false,"cancelled":true}`.
- Jobs run one at a time. A bad job returns `ok:false`; the process never exits on errors. `shapes` = folder of `<characterId>.svg` replacing those shapes; `scripts` = AS2 folder; output is written to `out.tmp`, then moved.
- The client sends one job at a time and drops queued jobs for the same `out` when a newer one arrives. The wrapper's own `cancel` covers clients that pipeline jobs (tested in the integration test).

## Measurements (open spec question: warm build time)

FFDec 26.3.0, Temurin JRE 8u504, Windows 11, one machine, hot file cache, sample = the spike's skeleton SWF + 1 SVG + 3 AS2 files (`tests/fixtures/ffdec`). Run with `INKWELL_BENCH=1 yarn vitest run src/main/build/ffdecWrapper.integration` (needs `java` on PATH).

| Stage | Runs | min ms | median ms | max ms |
| --- | --- | --- | --- | --- |
| Cold CLI build (`ffdec-cli.exe` twice: shapes, then script) | 10 | 1582 | 1629 | 1728 |
| First wrapper job in a fresh JVM (wrapper-measured) | 5 | 481 | 497 | 505 |
| First wrapper job, client wall incl. process spawn and JVM start | 5 | 567 | 578 | 604 |
| Warm jobs 2..30 (wrapper-measured) | 145 (5 JVMs x 29) | 8.5 | 15.2 | 25.9 |
| Warm jobs 2..30 (client wall: send to reply, incl. stdin/stdout) | 145 | 8.9 | 15.8 | 26.5 |

Reading: a warm build is about 16 ms end to end, transport adds under 1 ms. The first job costs about 0.6 s including JVM start, so start the wrapper at project open, not at the first build.

Caveats. Excluded: Figma sync, IR to SVG/AS2 codegen, preview load, and any time before `build()` is called. The sample is tiny (one rectangle, three small scripts); real menus will take longer, so re-measure on `samples/hud-minimal` once codegen exists. Cold CLI was 2.4 s median in the spike (bimodal, 1.6-2.8 s); this run sat at the fast end, so cold numbers vary with machine state. Cold includes two process launches, so cold and wrapper figures are not like-for-like. Disk cache, antivirus and power state were not controlled. Byte-identical output across two wrapper builds is asserted by the integration test; equality with the CLI output was checked in the spike (Nashorn path), not re-checked for this Java wrapper.
