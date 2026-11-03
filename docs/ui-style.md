# UI style: the Filled style

The one look of every control in the editor. Read this before changing any UI, and update it when a rule changes. It is written for the owner and for any AI working in this repo.

Chosen 2026-10-31 from three directions (A Filled, B Outlined, C Soft). A was picked because it uses the tone steps the dark theme already has and draws the fewest lines, so a dense graph screen stays calm. Nothing here has been checked against a screenshot of every screen; see "Known gaps".

## Where things live

| What | File |
| --- | --- |
| Every colour and the control tokens | `src/renderer/theme.css` (the only place with colour values) |
| Shared control rules, panels, dialogs | `src/renderer/styles.css` (one global sheet, no scoping) |
| Graph canvas and node controls | `src/renderer/graph/graph.css` |
| The button component | `src/renderer/ui/Btn.tsx` (also `Fold`, `Popover`, `Tip`, `Dialog` in `ui/`) |
| All UI text | `src/renderer/strings.ts` |

## Tokens (`theme.css`)

| Token | Value | Use |
| --- | --- | --- |
| `--ctl-h` | 28px | Height of buttons, dropdowns and fields |
| `--ctl-h-sm` | 24px | Rows inside a list, fields on canvas nodes, dropdown options |
| `--radius` | 4px | Every corner |
| `--radius-chip` | 3px | Chips, badges, keys inside segmented controls |
| `--field-bg` | `--sunken` | Fields and dropdowns (one step darker than the pane) |
| `--btn-bg` / `--btn-bg-hover` | `--surface-2` / `--surface-3` | Buttons (one step lighter than the pane) |

Use the tokens, never a literal height, radius or colour. Rare exceptions that stay literal: round things (`50%` dots, the 18px focus badge), pill overlays on the preview stage (`.mode-chip`), the node run glow.

## The rules

1. **No borders on controls.** Separation is a tone step: fields are darker than the pane, buttons are lighter. Borders are `1px solid transparent` so sizes do not jump. Focus shows a 1px `--accent` border on fields and a 1px inset `--accent` ring on buttons and tabs (`:focus-visible`), a 2px `--focus` outline elsewhere.
2. **Height.** 28px for buttons, dropdowns and fields. 24px for list rows, node fields and dropdown options. Icon-only buttons are 28px squares.
3. **Radius.** 4px everywhere, 3px on chips. Do not add 5, 6, 8 or 10.
4. **Buttons** (`Btn`, class `.btn`): secondary is filled one step up. `variant="primary"` is an ink fill, at most one per screen area (Build All). `quiet` has no fill, for toolbars. `variant="danger"` is for a button with text that deletes, discards or removes: error text on the normal button fill, `--err-bg` on hover (a permanent tint was too loud). Quiet "Delete ..." confirms use `.row-confirm-delete` (error text, tinted hover), row menu items use `.is-danger`. An icon-only delete or remove button (trash, or the X that removes a row) gets `className="btn-hover-err"`: neutral at rest, the icon turns `--err` on hover, background unchanged (the row menu's `.menu-del` does the same). The X that unlinks a data binding counts as a remove. Cancel, close and clear-a-log buttons stay neutral. A disabled button (`reason` set) is dimmed, never dashed, and keeps its reason as tooltip. `Btn` adds `btn-icon` (a square) by itself when it has no visible text. Never test for an icon-only button in CSS with `:has(> svg:only-child)`: text nodes are ignored, so labelled buttons match too (this squeezed the preview toolbar labels once).
5. **Dropdowns** are plain `<select>` elements. `select { appearance: base-select }` (Chromium 135+, Electron 45 has it) lets CSS style the open list too: `::picker(select)`, `option`, `::picker-icon`. The closed field is a filled field with a chevron at the right. The `select` rule centres its text with `display: inline-flex; align-items: center` (without it the text sits too high). If you need a dropdown, use a `<select>`. A custom popover list is only for rows that carry more than a label.
6. **Fields** (`input`, `.input`, `.gn-input`): filled, no border, `padding: 0 8px`. Set `background-color`, never the `background` shorthand on a select (it wipes the chevron).
7. **Tabs** are underline tabs everywhere: `.tab`, the dock tabs, `.pack-tabs`, and the mode switcher (`.seg.seg-tabs`). No boxed or italic tabs. The Inspector has up to four of them (Behavior, Translations for text layers only, In game, Figma: `.insp-tabs` holding `.tab` buttons; a count badge on In game when the layer has issues and on Translations when languages are missing; an issue picked in the Lint dock opens In game). A segmented choice (Preview / Game) is `.seg` with `.btn-seg` buttons on a sunken track.
8. **Hotkeys** are plain dim text in the format `Ctrl+C`, with `kbd` or the label, at the right of what they trigger. No boxes. Strings use `Ctrl+Z`, never `Ctrl Z`. Single keys stay as they are (`F`, `Del`, `Space`).
9. **Section titles** are sentence case, 12px, semibold, dim: `Graphs`, `Layers`, `Fields`, `Issues (3)`. No uppercase text in `strings.ts` and no `text-transform: uppercase` or letter-spacing in CSS for titles.
10. **Chips** (`.chip`) are filled one step up, 11px text, 18px high.
11. **Status bar** has no dividing lines. Rare facts (spec version, FFDec, packs) live in the Environment popover, not in the bar.
12. **Type sizes**: 12px for controls and rows, 11px for chips and hints, 14px for the Inspector node name. Add another size only with a reason.
13. **Checkbox or toggle button.** A property of a thing (a variable, a setting, a dialog option) is a checkbox in a `label.check` row (24px high, the whole row clicks). A view or filter option in a toolbar or dock ("Current SWF only") is a `Btn pressed`. The checkbox is drawn by our CSS (`input[type=checkbox]` in `styles.css`): 14px, `--field-bg` fill, `--radius-chip`, accent fill with a mask check when on, inset accent ring on focus, 40% opacity when disabled. Never `accent-color` or the native box. A disabled checkbox shows its reason as a hint line under it (`.var-pop-hint` in the variable popup), not only in `title`.

14. **Node Inspector pin rows** (`graph/PinRows.tsx`, classes `pinrow-*`). Sections `Inputs` and `Outputs` (and `Issues`) are cards (`.insp-card`, see rule 15) with an in or out icon in the title; fields inside are darker still, wire rows lighter (hidden when empty; the pack's own fields such as Value type follow the input pins). One row per pin: a dim 11px label above, then its field (unwired input), or a `.pinrow-wire` row naming the node it is wired from or to with a go-to button, or a dim "Not connected". The mock data link on a String, Number or Bool input copies the layer Data section: the `Link` quiet button opens a `.bindfld-pop` popover with a "Mock data" group and "New field"; bound it shows the filled `.bindfld-value.is-bound` box (name, dim type, "Preview only" chip, warning triangle) and the `X` button. Reuse those classes, do not add a second look. The node's kind and the start of its ID sit in a dim 11px footer (`.insp-foot`, selectable, with a copy button for the full ID), not in a fold. Outputs and flow pins have no mock button. The same popover also binds an input to a graph variable: that adds a real Get Variable node and wire (`bindInput` in `graphStore.ts`), so its bound box has no "Preview only" chip. Variable and mock data are told apart by icon, not colour: a `Link` icon on every variable row and bound variable box, a `FlaskConical` on every mock data row and bound mock box, and a rule between the two groups (`.pinrow-opt`, `.pinrow-ico`, `.pinrow-rule`) and the x removes the wire and the node. An input wired from another kind of node offers mock data only (a variable would replace the wire); a variable named like a mock field still takes its value in the preview, which is how to mock a variable-bound input.
15. **One Inspector shape** (`ui/InspParts.tsx`). Every Inspector (graph node, component props, layer) is `<div className="insp insp-fill">` with `InspHeader` (name 14px, a dim 11px type line, an optional action at the right such as Select in Figma; a node's description follows), then its sections, then `InspFoot` at the very bottom (kind or ID in 11px mono, a copy button; `.insp-fill` and `.panel-body:has(> .insp-fill)` make the footer sit at the bottom, with at least 24px above it). A section is `InspCard` (`.insp-card`: `--bg`, a step darker than the pane, 10px padding, 12px between cards, a 12px semibold title with an optional dim icon and actions at the right) or `InspFold` (the same card that folds; the title row is the summary, its text shows while closed; open state is kept for the session). Fields inside a card are `--field-bg`, wire rows `--btn-bg`. The old `Fold` (`.fold`) stays for dialogs and the menu settings form. The menu settings form (`menu/MenuSettingsForm.tsx`, 2026-11-02) is one narrow column of four `Fold`s drawn as cards like `.insp-fold` (`.menu-cols > .fold`: `--bg`, 12px apart; Opens with, While open, On screen, Advanced), each showing a one-line summary of what is on while closed; only Opens with starts open. It is grouped by who or what a control affects (player vs scripts and mods; the game vs the player), the menu name is edited only in Advanced, and an unbuilt feature (Gamepad combo) is a hint line, not a disabled row. Not converted yet: the Inspector's In game, Translations and Figma tabs (flat lists) and the Function Entry and Exit signature editors.

14. **A data type is a colored dot.** Variables bar chips, the Data Binding tab, node pins and the Mock Data tab show a type as an 8px round dot (`.var-chip-dot`, color `PIN_STYLE[type].color` from the `--pin-*` tokens) followed by the dim type word. A thing whose type is not known yet gets a hollow dot (`.mock-dot-none`). Do not show a type as a bare word or a filled dropdown where a dot fits. The Mock Data tab keeps the type word as a quiet dropdown (`.mock-type`), because a value typed into a field that has no value yet only guesses the type (`inferMock`: `true`/`false` is Bool, a number is Number, else String).

15. **An input bound to mock data** shows no value box of its own on a canvas node. It shows the mock field's current value in dim italics with a link icon (`.gn-mock`, `MockInputValue` in `NodeView.tsx`); the key is the tooltip. A wire into the same input or a deleted field adds a warning triangle (the wire is not used in the preview; "No value" with a hollow dot). That wire is drawn dashed and dim (`.gw-skipped`, set in `GraphCanvas.tsx` `styledEdges`).

16. **Deploy menu** (`shell/DeployMenu.tsx`, 2026-11-02, option B). It opens on the one choice made every time: a list of targets (`.deploy-target`: name, then the exact path in dim 11px under it, cut at the start with `direction: rtl` + `<bdi>` so the mod folder name at the end stays; full path in the tooltip). Settings that rarely change sit in a footer: scope as a `.seg` of `Btn.btn-seg` (`.deploy-scope`), the Dev deploy checkbox (custom menus only), and Set folders as a quiet icon button. A lint summary line (dot plus text, only when there are warnings or errors) comes first. No title (it repeats the button) and no group headings.

17. **Preview settings** (`preview/previewSettings.tsx`, 2026-11-03). One icon-only button at the end of the stage toolbar (after Pop out) opens a popout. Overlays are toggle buttons with icon and text in a 2-column grid (`.pv-overlay-btn`, quiet, `pressed`): a view option, so a `Btn pressed`, not a checkbox (rule 13). Margins shows its pixel field under the grid only while on. Background is a `.seg` (None, Color, Image) with a hex field, three presets and a file picker; its heading carries a dim "Preview only" hint. All of it is session state of the preview and never reaches a build, deploy or project. A background reloads the movie with Ruffle `wmode: transparent` (`PreviewBackend.setTransparent`) so it shows through; that is the one thing it changes in the running preview.

18. **Setup guide** (`shell/FirstRunWizard.tsx`, 2026-11-03). A first-run and View > Setup Guide view of its own (no top bar or status bar): the step rail (`.wiz-rail`, each step a button that jumps to it) at the left and the current step centred in the rest (`.wiz-stage` > `.wiz-pane`, 760px wide), the checks as `--surface-1` cards (a head row with dot, name and fix button, a short status word, and the check's sentence on its own line below only when the check is not ready: a ready row repeats the path its field shows), `Skip setup` at the left of the footer and `Step n of 4`, Back and Next together at the right. For Java, FFDec and the Papyrus compiler, while the path has no saved value and the check is not ready, the field's Clear button becomes a Download icon button that opens the tool's page (`download` prop of `SettingField`; Settings does not pass it). The footer sits under the content, not pinned to the window bottom. A centred card with a horizontal stepper was tried and dropped.

## Docks fold

The bottom dock of every workspace is one `TabGroup` in `workspace/Workspace.tsx` and can fold to its tab strip.

- Layout data: a tabs node has `foldable` and `folded` (`workspace/layout.ts`); `tabs(panels, active, size, 'folded' | 'open')` in `workspaces.ts` sets them. Layout and Behaviour start folded, Localization starts open.
- State: `folds` in `state/workspaceStore.ts` (session only, not persisted), applied by `applyOverrides`. `showDockTab(panel)` opens the tab and unfolds the dock.
- User actions: the chevron at the right of the strip folds or opens it, clicking the selected tab folds it, clicking any tab while folded opens it.
- Strip extras: `stripExtras` on `Workspace`, keyed by a panel id in the group (`AppShell.tsx`, `STRIP_EXTRAS`). The Behaviour dock shows `shell/DockStrip.tsx` (trace line count and Hot Reload, the shared `hooks/useHotReload.ts`).

## Fullscreen graph

The icon button next to Tidy in the Graph panel sets `graphFull` (`workspaceStore`, session only). `WorkspaceView` passes `overlayEdges` to `Workspace` (Behaviour only), which sets `data-overlay` on `.workspace`. Layout nodes with an `edge` (`left`, `right`, `bottom`; set in `workspaces.ts`, kept by `removePanel`) become `data-edge` and, under `.workspace[data-overlay]`, leave the flow. The graph stays mounted, so its view is kept. Left and right slide in on hover of a 24px hot strip (`::after`) or focus inside; the dock stays as its tab strip (a reserved `--dock-strip-h`) and opens over the graph at 45% height. Splitters are hidden meanwhile. A new edge node needs no CSS.

## Pack text for the Inspector

A node definition can carry `extra.inspector` (no spec change, optional): `description` (one line under the node name), `labels` (field or unwired pin name to the label shown) and `options` (field name to option value to label). Only the Inspector reads them (`fieldRows(..., inspector = true)` in `model/graphModel.ts`); the canvas node keeps raw names. A field without a label shows its name as words (`valueType` becomes "Value type"). Only Compare has text so far (`Inkwell-Core-Pack/nodes/Compare.json`, `CHANGELOG.md`). After editing a pack run `yarn sync:core-pack`.

## Adding or changing a control: checklist

1. Reuse first: `Btn`, `Fold`, `Popover`, `Tip`, an existing class. A new look needs a reason in this file.
2. Take height, radius and fills from the tokens. No literal colours.
3. Strings go in `strings.ts`, sentence case, hotkeys as `Ctrl+X`.
4. Name new classes with a component prefix (`deploy-target`, `dock-strip`). Never a bare word (`row`, `item`, `seg`, `group`, `tip`, `dot`). The sheet is global.
5. Before adding or removing a class, grep `styles.css` and `graph.css` for `\.name\b` and every `*.tsx` for the name in `className` strings, including ancestor selectors (`.menu li button`). An `!important` means something else was being overridden.
6. Typecheck and tests do not see CSS. Look at the screen, and check the neighbours: top bar, the three docks, preview toolbar, Variables, Inspector, a dialog, the status bar.
7. If markup changed that a screenshot driver (`screenshot*.ts`) uses, update the driver or say it was not run. The Variables add form is closed once there are variables, which `screenshotGraph.ts` does not expect.

## Known gaps

- The Translations tab (Inspector) draws its language rows with `.insp-loc-row` and borrows the table's missing marker (a 2px warn bar on an empty field); the Localization table and this tab are the only two places that use it.

- Knotwork pieces (zoom buttons, minimap, the canvas shortcut list layout, the Events list) are only lightly restyled from here. Fully matching them needs a change in the Knotwork repo and a new pinned tag.
- Dialogs, Settings and the Setup Doctor inherit the new rules but were not reviewed one by one.
- Some literal `4px` radii remain in `styles.css`; they equal the token and can be swapped when touched.
- The canvas shortcut list is still always on screen (an always-visible overlay). A "?" button to show it was proposed and not built.
- Only Compare has Inspector text; the other core pack nodes show humanised field names.
- None of this has been verified in Skyrim or against a full screenshot sweep; it was checked with `yarn typecheck` and `yarn test` and by the owner's screenshots of the top bar, preview toolbar and dropdowns.

## History

- Findings and the three directions, as shown to the owner: the artifact "Inkwell Style System" (claude.ai). The "before" counts: 4 dropdown looks, 5 button looks, 3 hotkey looks, 3 tab looks, 10 corner radii, 6 control heights, 2 section title styles.
- Fixed after the first rollout: icon-button square rule matching labelled buttons (see rule 4); the native OS dropdown list (rule 5); select text sitting too high (rule 5).
