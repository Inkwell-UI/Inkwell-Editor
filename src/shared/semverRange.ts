/**
 * Does `version` satisfy a pack's `compatible.tool` range? Supported: `^x.y.z`, `~x.y.z`, `>=`, `>`, `<=`, `<`, `=` or a bare `x.y.z`, and several of them separated by spaces (all must hold).
 * shortcut: no `||`, no `x`/`*` wildcards and no pre-release ordering (a pre-release tag is ignored); an unparseable range is NOT satisfied. Upgrade to the `semver` package if packs need more.
 */
type V = [number, number, number]
const parse = (s: string): V | undefined => {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(s.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined
}
const cmp = (a: V, b: V): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

export function satisfies(version: string, range: string): boolean {
  const v = parse(version)
  if (!v || !range.trim()) return false
  return range.trim().split(/\s+/).every((term) => {
    const m = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(term)
    const r = m ? parse(m[2]!) : undefined
    if (!m || !r) return false
    switch (m[1]) {
      case '^': // the leftmost non-zero part may not change (^0.5.0 = >=0.5.0 <0.6.0, ^0.0.3 = 0.0.3)
        return cmp(v, r) >= 0 && (r[0] > 0 ? v[0] === r[0] : r[1] > 0 ? v[0] === 0 && v[1] === r[1] : v[0] === 0 && v[1] === 0 && v[2] === r[2])
      case '~':
        return cmp(v, r) >= 0 && v[0] === r[0] && v[1] === r[1]
      case '>=': return cmp(v, r) >= 0
      case '>': return cmp(v, r) > 0
      case '<=': return cmp(v, r) <= 0
      case '<': return cmp(v, r) < 0
      default: return cmp(v, r) === 0
    }
  })
}
