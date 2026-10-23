# Setup Doctor (`src/main/doctor`, `src/renderer/doctor/SetupDoctorPanel.tsx`)

UX spec 5.3. Inkwell bundles no Java, FFDec, Papyrus compiler, Creation Kit or game file; the Doctor shows what it found on this computer and offers a fix for every row. Open it from the top bar (stethoscope icon), the start screen, or the status bar link `FFDec: not found`. It opens by itself once, on the first launch where a check **fails** (`doctorSeen` in `settings.json`; warnings alone do not open it).

## Checks (`doctor/checks.ts`, run in parallel by `runDoctor`, never throw)

Each returns `{ id, label, status: pass|warn|fail|skipped, detail, fix?, extra? }`. A check that throws becomes a `fail` row. `fix.action` is one of `browse` (native dialog, stores the setting), `copy` (clipboard), `open` (https page only), `run` (`benchmark`, `buildVanillaCache`).

| id | Passes when | Notes |
| --- | --- | --- |
| `java` | `INKWELL_JAVA` / settings / `java` on PATH runs and is Java 8 or newer | `-version` is parsed for both `1.8.0_x` and `17.0.x` styles |
| `ffdec` | `lib/ffdec_lib.jar` exists in the FFDec dir (`INKWELL_FFDEC`, setting, else `C:\Program Files (x86)\FFDec`) and its version equals the wrapper's pin | the version is read from `project.properties` inside `ffdec_lib.jar` (`doctor/zip.ts`), because the install's metainfo and changelog lag nightly builds; a mismatch is `warn` and says the wrapper refuses to build on another version |
| `wrapper` | `tools/ffdec-wrapper/build/ffdec-wrapper.jar` exists (else hint `yarn build:wrapper`) | its fix is the benchmark: FFDec CLI cold (median of 3) vs wrapper first job vs warm median of 10 on `tests/fixtures/ffdec`; user-triggered, numbers shown in the row |
| `papyrus` | `INKWELL_PAPYRUS` / setting points at russo's `papyrus.exe` and a probe script compiles against `resources/papyrus-stubs` | `warn` when unset (HUD widgets then deploy as SWF only); says it is user-installed and not bundled; optional Creation Kit sources path |
| `skyrim` | `SkyrimSE.exe` found via the manual setting, Steam (registry `HKLM\SOFTWARE\WOW6432Node\Valve\Steam` `InstallPath`, every library in `steamapps\libraryfolders.vdf`, folder `steamapps\common\Skyrim Special Edition`) or GOG (`HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\*`, entry named Skyrim Special Edition), and `Data\Skyrim - Interface.bsa` exists | registry via `reg query`, file version via PowerShell, no native module. Runtime label from a table (`skyrim.ts`): 1.5.97 SE, 1.6.317 to 1.6.1179 AE; any other version is `warn` and reported as "not in Inkwell's table" with its family (SE 1.5.x, AE 1.6.x, 1.7.x) |
| `vanilla` | the cache for this archive's sha256 is built | `buildVanillaCache` extracts every `.swf` of `Skyrim - Interface.bsa` into `<userData>/vanilla-cache/<archiveHash>/` (never into a project or the repo) and writes `index.json` last; the row shows entry count, size, path |
| `projectIgnore` | the open project's `.gitignore` excludes `build/`, and the cache folder is not inside the project | skipped without a project |
| `figma` | manifest found and a plugin is connected now | manifest: setting `figmaManifest` / `INKWELL_FIGMA_MANIFEST`, else the sibling checkout `../Inkwell-Figma/plugin/manifest.json` next to the editor; Copy button; handshake = the sync server's connection count |

## BSA reader and vanilla cache (`src/main/vanilla`)

`bsa.ts` is the only place that knows the format (Skyrim SE, version 105, per-entry LZ4 frames through `lz4js`): `openBsa`, `extractEntry`, `sha256File` (streaming). `cache.ts`: `buildVanillaCache`, `vanillaCacheStatus`, `loadVanillaHashes`, and **`isUnmodifiedVanilla(bytes, hashes)`**, which Deploy uses to refuse exporting vanilla files (an empty cache never matches, so build it to get the protection). Tests build tiny synthetic archives (uncompressed, compressed, default-compressed with embedded names). The vanilla Interface archive has no compressed entries, so the LZ4 path is only covered by those synthetic archives and the spike's mod archives.

## Settings (`src/main/settings.ts`)

`<userData>/settings.json`, validated on load (unknown keys, wrong types and empty values are dropped; a damaged file means defaults). `resolveSettings(stored, env)`: an environment variable beats the stored value, which beats the default; `source` says which. Keys: `ffdecDir` (`INKWELL_FFDEC`), `javaPath` (`INKWELL_JAVA`), `papyrusExe` (`INKWELL_PAPYRUS`), `creationKitSources` (`INKWELL_CK_SOURCES`), `skyrimPath` (`INKWELL_SKYRIM`), `figmaManifest` (`INKWELL_FIGMA_MANIFEST`), `mo2ModsDir` (`INKWELL_MO2_MODS`), `mo2OverwriteDir` (`INKWELL_MO2_OVERWRITE`), `mo2ModName`; plus `deployConfirmed` and `doctorSeen`. A changed Java or FFDec path restarts the build pipeline (the project is reopened on the same sync port and token). The panel's "Deploy folders" section edits the MO2 keys; fields set by an environment variable are shown read-only.

## UI

`SetupDoctorPanel` (a modal panel, not a layout panel, so it lives in `src/renderer/doctor/`) takes no props: `useSetupDoctor()` runs the checks on mount and on Re-run, exposes the two on-request tasks, and every row has a Lucide status icon (with an accessible name), the detail text and its fix buttons. Strings live in `strings.doctor`; colours come from the theme variables. IPC: `runDoctor`, `runBenchmark`, `buildVanillaCache`, `doctorFirstLaunch`, `getSettings`, `setSetting`, `browseSetting`, `openExternal`.

## Tests

`doctor/*.test.ts`: Java version parsing and checks with an injected runner, `.gitignore` rules, vdf and registry parsing, the runtime table, the zip reader, "never throws" with everything pointing nowhere, and a read-only run against the real machine (prints each check). `INKWELL_PAPYRUS` makes the Papyrus row real in that run.

## Not done

- The Figma row has no screenshot guide for importing the plugin (UX 5.3 asks for one) and no handshake test beyond "a plugin is connected".
- Creation Kit sources are stored and shown but nothing consumes them yet (only the Creation Kit compiler needs them).
- The runtime table needs new versions added by hand.
