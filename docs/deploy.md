# Deploy (`src/main/deploy`, `src/renderer/shell/DeployMenu.tsx`)

UX spec 4.1, MO2 only. The top bar `Deploy` dropdown lists targets with their exact folder; `Build All` stays separate. Vortex staging and `Package Mod` are shown disabled with the reason `Planned`.

## Targets (`plan.ts` `resolveTarget`)

- `MO2 mod folder`: `<mo2ModsDir>\<mod name>` (mod name setting, default the project name; no separators allowed). Without `mo2ModsDir`, an `mo2` preset in `project.json` (`deploy.path`) is the fallback.
- `MO2 overwrite folder`: `mo2OverwriteDir`.
- Both are set in Setup Doctor > Deploy folders (or `INKWELL_MO2_MODS`, `INKWELL_MO2_OVERWRITE`). The dropdown also chooses the scope: all SWFs, or only the active one.

## What is written (`planDeploy`, pure: project + settings -> file plan)

| SWF target | Files |
| --- | --- |
| `hudWidget` | `Interface\exported\widgets\<modId>\<Widget>.swf`, `Source\Scripts\*.psc`, and with a Papyrus compiler `Scripts\*.pex` and `<modId>.esp` (the `compileWidget` layout; widget name = SWF name with a capital) |
| `customMenu` | `Interface\<name>.swf` only. **The runtime menu JSON format is not in inkwell-spec yet**, so the menu will not open by itself; the dropdown and the confirmation dialog say so |
| `menuReplacement` | skipped with warning `menu-replacement-skipped` |

Without a Papyrus compiler (setting or `INKWELL_PAPYRUS`) a widget is deployed as SWF plus `.psc` sources, with warning `papyrus-compiler-missing`. Only one `.esp` is generated per mod (a second widget warns `widget-esp-shared`).

## Rules

- **Never into the game's `Data` folder**: refused when the target is inside `<Skyrim>\Data` for any detected install, or matches `\Skyrim*\Data` by name (tested both ways). Nothing is compiled first.
- **Never outside the target folder**: every path (planned, and every path read from an older manifest) goes through `safeJoin` (no absolute or drive paths, `..`, empty parts, reserved characters). A bad SWF name fails the plan before any write.
- **Never unmodified vanilla files**: every `.swf` is hashed against the vanilla cache index (`isUnmodifiedVanilla`); a match refuses the whole deploy.
- **First deploy to a new target asks**: the dialog shows the exact path and the file list (and files that will be removed, warnings, notes). The confirmation is remembered per project and folder in `settings.json` (`deployConfirmed`) after the first successful deploy.
- **Manifest** `.inkwell-deploy.json` (version, mod id, time, `files[rel] = { sha256, swf }`). A later deploy deletes only files named in the old manifest that this deploy no longer produces, and only if they are still byte-identical to what Inkwell wrote (a hand-edited file is kept and reported). Folders emptied by that are removed. Other files are never touched. An "active SWF only" deploy retires only that SWF's files.
- **Atomic-ish writes**: temp file in the same folder, then rename; identical files are not rewritten. The manifest is written last. All compiling and checking happens before the first write (`prepare`, then `commit`, so the confirmation can come between).

## Flow and feedback

`prepareDeploy(target, scope, activeSwf)` (IPC) compiles with the resident FFDec wrapper and the Papyrus compiler, checks, and returns the file list and `needsConfirm`; `commitDeploy(token)` writes. Progress and the result are in `SyncUiState.deploy`: the status bar item (`Deploy: 856 ms [Compile 845 ms - Vanilla check <1 ms - Write 11 ms]`) and a toast with the counts. Compile errors (including Papyrus) abort before writing. A `customMenu` needs its SWF built first (Build All); a missing build is an error that says so.

## Tests

`plan.test.ts` (planner, Data refusal, traversal, targets, confirmation state), `write.test.ts` (manifest diff and cleanup, foreign files untouched, tampered manifest, atomic writes, scope), `run.test.ts` (vanilla refusal, missing build, and a real deploy of `samples/hud-widget` into a temp folder; that one needs Java, FFDec and the wrapper jar, and `INKWELL_PAPYRUS` for the `.pex` and `.esp`).

## Known limits

- `.pex` files embed a compile timestamp, so they are rewritten on every deploy even when nothing changed.
- Deploy uses the pipeline's resident FFDec wrapper; a build in progress queues behind it.
- No hot reload and no Vortex or zip packaging yet.
