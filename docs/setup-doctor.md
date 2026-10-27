# Setup Doctor and Settings (`src/main/doctor`, `src/renderer/doctor/SetupDoctorPanel.tsx`, `src/renderer/shell/SettingsView.tsx`)

UX spec 5.3. Inkwell bundles no Java, FFDec, Papyrus compiler, Creation Kit or game file; the Doctor shows what it found on this computer and offers a fix for every row. It lives in the Settings view: open it with Edit > Settings (Ctrl+,), the Deploy menu's folders button, or the status bar link `FFDec: not found`. It opens by itself once, on the first launch where a check **fails** (`doctorSeen` in `settings.json`; warnings alone do not open it).

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
| `mo2` | the MO2 mods directory exists and is a folder, the mod name (setting, default the project name) is one valid folder name, the target `<mods>\<name>` is not inside a game `Data` folder (detected installs and the `Skyrim*\Data` name pattern) and can be written (a temp file `.inkwell-write-test-*` is created and removed; the target itself is not created), and the overwrite folder, if set, passes the same tests | `warn` when neither folder is set; fixes: Browse for either folder, Clear (invalid mod name); the same Data rule as Deploy `isGameData` |
| `projectIgnore` | the open project's `.gitignore` excludes `build/`, and the cache folder is not inside the project | skipped without a project |
| `figma` | manifest found and a plugin is connected now | manifest: setting `figmaManifest` / `INKWELL_FIGMA_MANIFEST`, else the sibling checkout `../Inkwell-Figma/plugin/manifest.json` next to the editor; Copy button; handshake = the sync server's connection count |

## BSA reader and vanilla cache (`src/main/vanilla`)

`bsa.ts` is the only place that knows the format (Skyrim SE, version 105, per-entry LZ4 frames through `lz4js`): `openBsa`, `extractEntry`, `sha256File` (streaming). `cache.ts`: `buildVanillaCache`, `vanillaCacheStatus`, `loadVanillaHashes`, and **`isUnmodifiedVanilla(bytes, hashes)`**, which Deploy uses to refuse exporting vanilla files (an empty cache never matches, so build it to get the protection). Tests build tiny synthetic archives (uncompressed, compressed, default-compressed with embedded names). The vanilla Interface archive has no compressed entries, so the LZ4 path is only covered by those synthetic archives and the spike's mod archives.

## Settings (`src/main/settings.ts`)

`<userData>/settings.json`, validated on load (unknown keys, wrong types and empty values are dropped; a damaged file means defaults). `resolveSettings(stored, env)`: an environment variable beats the stored value, which beats the default; `source` says which. Keys: `ffdecDir` (`INKWELL_FFDEC`), `javaPath` (`INKWELL_JAVA`), `papyrusExe` (`INKWELL_PAPYRUS`), `creationKitSources` (`INKWELL_CK_SOURCES`), `skyrimPath` (`INKWELL_SKYRIM`), `figmaManifest` (`INKWELL_FIGMA_MANIFEST`), `mo2ModsDir` (`INKWELL_MO2_MODS`), `mo2OverwriteDir` (`INKWELL_MO2_OVERWRITE`), `mo2ModName`; plus `deployConfirmed`, `doctorSeen` and `figmaPlugins` (SHA-256 of approved Figma plugin secrets, `docs/sync-server.md`). A changed Java or FFDec path restarts the build pipeline (the project is reopened on the same sync port).


## UI

**Settings view** (`shell/SettingsView.tsx`, `strings.settings`): replaces the workspace (or the start screen) while `dialogStore.open === 'settings'`; Esc or Back closes it. A search field at the top of a centred column filters the General section (Mirror Figma selection) and the check rows (title, detail, field labels, setting keys, environment variable names). The Edit menu entry is built in `main/index.ts` and reaches the renderer as `menu:settings` (`onOpenSettings`).

`SetupDoctorPanel` (not a layout panel, so it lives in `src/renderer/doctor/`) takes an optional search `query` and otherwise no props: `useSetupDoctor()` runs the checks on mount and on Re-run, exposes the two on-request tasks, and every row has a Lucide status icon (with an accessible name), the detail text, its settings and its fix buttons. Strings live in `strings.doctor`; colours come from the theme variables.

**Every path setting is a field in its row** (`ROW_SETTINGS` in `shared/doctor.ts`): Java -> `javaPath`; FFDec -> `ffdecDir`; Papyrus -> `papyrusExe` and `creationKitSources`; Skyrim -> `skyrimPath`; Figma -> `figmaManifest`; MO2 -> `mo2ModsDir`, `mo2ModName`, `mo2OverwriteDir` (the old "Deploy folders" section is gone). A field has an editable input, Browse (not for the mod name), Clear, a badge with where the value comes from (`saved setting`, `from INKWELL_...`, `default`, `detected` for the Steam/GOG install and the sibling Figma manifest; a default or detected value is the placeholder), and a busy state while it saves and its check re-runs. Enter, leaving the field and Browse all commit. A value set by an environment variable is read-only with the variable named, and its Browse/Clear are disabled with that reason (the variable wins over the saved value; the old Browse buttons stored a value that was then never used, without saying so).

**One change, one partial re-run.** `setSetting` and `browseSetting` return `SetSettingResult` (`{ ok: true, settings, cancelled? }` or `{ ok: false, error }`), never a bare rejection. Then only `checksForSetting(key)` run (`runDoctor(only)`) and `mergeResults` replaces those rows (Java -> `java`; Skyrim -> `skyrim`, `vanilla`, `mo2`; the MO2 keys -> `mo2`). Failures end up on the field (`role="alert"`): a refused value (line breaks; a mod name that is a path), a disk write failure (with the path), an IPC failure, a failing dialog. `ResolvedSettings.problems` (from `inspectSetting`, computed for every explicitly set value) gives the specific message under the field: does not exist, is a file not a folder, is a folder not a file, not a `.exe`, not an FFDec or Skyrim folder (no `lib\ffdec_lib.jar` / `SkyrimSE.exe`), not a `.json` manifest. A wrong path is saved anyway (its check row then fails with the same words); only malformed values are refused. Pasted values lose surrounding quotes (Explorer's "Copy as path"). The Deploy dropdown asks for its targets whenever it opens, so it shows new folders at once.

**Fonts for Figma** (`doctor/FontsForFigma.tsx`) sits below the checks: the opt-in tool that installs the game's fonts per user for Figma, with its notice, status, confirmation dialog, Install and Remove. See `docs/font-install.md`.

IPC: `runDoctor(only?)`, `runBenchmark`, `buildVanillaCache`, `doctorFirstLaunch`, `getSettings`, `setSetting`, `browseSetting`, `openExternal`.

## What went wrong before ("after Browse the fields don't fill and nothing is checked")

- **Dead panel in `yarn dev`.** The hook guarded every state update with an `alive` ref that was cleared on unmount and never set again. React StrictMode (dev) mounts, unmounts and mounts again, so the flag stayed false: no result and no setting ever reached the screen (0 rows, "Checking..." for ever, typed values never saved). Reproduced on the previous commit with the debug driver (`INKWELL_DOCTOR_LEGACY=1`). The flag is now set on every mount.
- **Errors swallowed.** `void inkwell.setSetting(...).then(...)` had no catch, so a rejection (disk, IPC, a throwing `probeJava`) left the screen as it was. `probeJava` threw synchronously on Windows for a file that is not a program (`spawn EFTYPE` / `UNKNOWN`) after the value was saved, so a Browse to such a Java never refreshed anything; it is now "Java not found".
- **Overlapping writes.** Enter and blur both committed, and `saveSettings` used one `settings.json.tmp` for every call, so two overlapping saves could fail the rename on Windows. Saves now use a unique temp name, retry the rename on EPERM/EBUSY/EACCES, and `session.setSetting` serialises its calls (and restores the old value when the write fails).
- **Values dropped silently** by validation (line breaks, empty text) and **environment overrides** shown as if the saved value was in use. Both are now reported on the row.

## Debug driver

`INKWELL_DOCTOR_DRIVER=1 INKWELL_SHOTS_PROJECT=<scratch copy of samples/hud-widget> INKWELL_SHOTS_DIR=<dir>` plus a separate `--user-data-dir` (`src/main/screenshotDoctor.ts`; no effect without the variable, and the dialog stub in `main/index.ts` is gated by it too). It opens the Settings view in the real window, types into every field (Enter and blur), answers the native file dialog itself (`dialog.answer`, because a script cannot click it), clears, sets an environment override, and checks the DOM (value, badge, problem, row status and detail), `settings.json` on disk, that the project stays open and the Deploy dropdown. It takes `dr-*.png` screenshots and exits 1 if an expectation fails. A second start with `INKWELL_DOCTOR_PHASE=2` and the same user-data dir checks the saved values come back. Run it through `electron-vite dev -- --user-data-dir=<dir>` (StrictMode on, the mode of the bug) or a build, with `ELECTRON_RUN_AS_NODE` unset. It really writes to `<userData>/settings.json`; never point it at a real user-data dir.

## Tests

`doctor/*.test.ts`: Java version parsing and checks with an injected runner, `.gitignore` rules, vdf and registry parsing, the runtime table, the zip reader, "never throws" with everything pointing nowhere, and a run against this machine (prints each check; if `INKWELL_MO2_*` is set, the mo2 check creates and removes a temp file there). `mo2.test.ts`: temp folders for valid, missing, file instead of folder, inside a fake Data folder, bad mod names, overwrite, partial runs. `settings.test.ts`: patch, resolve, validation, inspection messages, overlapping saves, a failing write. `shared/doctor.test.ts`: `checksForSetting`, `mergeResults`. `INKWELL_PAPYRUS` makes the Papyrus row real in the machine run.

## Not done

- The Figma row has no screenshot guide for importing the plugin (UX 5.3 asks for one) and no handshake test beyond "a plugin is connected".
- A truly unwritable folder is not unit-tested (Windows cannot make one portably); the write probe's failure path is covered with a path below a file.
- Creation Kit sources are stored and shown but nothing consumes them yet (only the Creation Kit compiler needs them).
- The runtime table needs new versions added by hand.

**Starter kit section (milestone 0.4).** Settings shows a text-only "Starter kit" section above "Fonts for Figma" (`doctor/StarterKit.tsx`): the checklist of `docs/starter-kit.md`. Nothing runs; it is searchable like the other sections.
