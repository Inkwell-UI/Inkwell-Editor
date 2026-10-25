Test-only pack node `core/Throw@1` (Debug): throws `{node, message}` so the try/catch of a handler logs the failing node id.
The core pack has no such node. Used by `src/main/codegen/codegen.debug.test.ts` and the Ruffle debug screenshot run
(`docs/debugging.md`): copy `resources/packs/core` to a scratch folder, add these two files (`nodes/`, `templates/`), and point `INKWELL_CORE_PACK` at it.
