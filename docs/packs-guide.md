# Node packs: adding more nodes (0.5)

A **node pack** adds nodes (for the graph editor) without a new editor version. A pack is **data**: JSON node definitions plus AS2 templates. Nothing in a pack runs inside the editor; the templates only turn into code in your menu when you use the nodes. Inkwell ships one pack, **core** (133 nodes), always loaded. Everything else comes from GitHub.

## Add a pack to a project

1. Open the **Library** tab (left side, Behaviour mode). Its **Packs** list shows the bundled core pack and the packs this project has installed, each with its state.
2. **Add Pack**: search the **Packs Index** by name, or type `owner/name` or a GitHub URL.
3. The confirm view shows the repo, the version, the **SHA-256** of the downloaded `pack.zip`, how many nodes it has and its changelog. Read it, then confirm. Only then is anything written.
4. The project now has `packs.lock` (commit it: it pins the exact pack version and hash) and `packs-cache/` (the downloaded copy; git-ignored).

The new nodes appear in the graph editor's Add menu like any other.

## Safety, plainly

- A pack is **never code** in the editor. Its templates become AS2 in your own SWF, so read what a pack does before you ship a menu that uses it.
- The editor refuses a pack whose hash differs from `packs.lock`: it never "fixes" it. A pack is only installed after you saw its repo, version and hash.
- `packs.lock` changes only when **you** install or update.
- Without network the editor keeps working: cached packs load and builds never need the net. A message says "Cannot reach GitHub (are you offline?)".
- Nodes of a pack you do not have are **kept** in your graphs (shown as unknown, never dropped) and work again once the pack is back.

## Update and restore

- **Check Updates** (only on request) shows the newer release's changelog first; nothing changes until you accept.
- On another computer: open the project and use **Download** in the Library tab to restore everything `packs.lock` lists. A pack removed from the index still restores from the source in its lock entry, with the same hash.

## Writing your own pack

Use **`Inkwell-Pack-Template`** (a complete pack with one node, a test and a release workflow) and read `Inkwell-Core-Pack/docs/packs.md`: the manifest, the node JSON, the AS2 templates and the placeholders, the validator (`yarn validate`), the release (`pack.zip` attached to the tag `v<version>`) and how to get listed in the Packs Index. Node ids are `<packId>/<Kind>@<major>`; a breaking change bumps the major.

## Limits

- Pack format and the lockfile are defined in the Spec (`pack.ts`, `packs lock`); the 0.5 beta tested the flow against fixtures and a fake network, not yet against real GitHub (the index and the template repos are not published yet).
- The core pack's own **Inventory** nodes only work in a menu replacement of that contract (see `docs/contracts.md`).
