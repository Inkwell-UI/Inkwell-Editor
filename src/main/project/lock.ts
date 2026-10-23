/**
 * Serializes writes to a project's files. The build pipeline rewrites ir.json/overlay.json after every build and the editor saves overlay.json
 * on every edit; without this a build could write back an overlay it read before the edit.
 */
let chain: Promise<unknown> = Promise.resolve()
export function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.catch(() => undefined)
  return run
}
