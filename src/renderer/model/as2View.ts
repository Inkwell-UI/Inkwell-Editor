/** Helpers for the AS2 split view over a source map (`Record<"<1-based line>", nodeId>`, docs/codegen.md, Source map). */

/** Source lines (1-based, ascending) that belong to `node`. */
export function linesOfNode(map: Readonly<Record<string, string>>, node: string | undefined): number[] {
  if (!node) return []
  return Object.entries(map).filter(([, n]) => n === node).map(([l]) => Number(l)).sort((a, b) => a - b)
}

/** The node a clicked line belongs to; a scaffolding line has none. */
export const nodeOfLine = (map: Readonly<Record<string, string>>, line: number): string | undefined => map[String(line)]

/** Plain split of a generated source into lines (no trailing empty line). */
export const sourceLines = (source: string): string[] => source.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
