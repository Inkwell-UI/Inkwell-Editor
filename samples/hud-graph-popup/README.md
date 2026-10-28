# HUD popup (graph)

A **HUD widget** (SkyUI loads it; no Inkwell Runtime) that shows a card with a title and a description, fades it in and out and is driven from Papyrus: the graph `Popup` has `On Widget Call: Show` (title, hold seconds), the graphs `Nodes test` and `Extras test` exercise many core nodes and report on a panel. It is the example for a notification or **achievement-style popup**.

- **Papyrus API:** the widget gets `Show(title, hold)` and `SetTexts`/`Hide` scripts (needs your Papyrus compiler: Settings > Papyrus compiler or `INKWELL_PAPYRUS`).
- **Deploy:** `yarn deploy:graph-popup` (to `Inkwell Graph Test`, needs Java, FFDec, the wrapper jar and `INKWELL_PAPYRUS`) or Deploy in the editor. SkyUI is required.
- The look (a dark card) is a placeholder: restyle it in Figma and sync; the graph and the API stay.
- Text keys `$TITLE` and `$DESCRIPTION` are the card's fields. See `docs/hud-widget.md`.
