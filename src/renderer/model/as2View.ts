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

export type As2TokenKind = 'comment' | 'string' | 'number' | 'keyword' | 'plain'
export interface As2Token { text: string; kind: As2TokenKind }

const KEYWORDS = 'break case catch class continue default delete do dynamic else extends false finally for function get if implements import in instanceof interface new null private public return set static super switch this throw true try typeof undefined var void while with'
const TOKEN = new RegExp(`(\\/\\/.*|\\/\\*.*?(?:\\*\\/|$))|("(?:[^"\\\\]|\\\\.)*"?|'(?:[^'\\\\]|\\\\.)*'?)|(\\b(?:0x[\\da-f]+|\\d+\\.?\\d*)\\b)|\\b(${KEYWORDS.replaceAll(' ', '|')})\\b`, 'gi')

/** Highlight tokens per line; a block comment may span lines (state carried), everything else is per line. Concatenating the texts gives back the line. */
export function highlightAs2(lines: readonly string[]): As2Token[][] {
  let inBlock = false
  return lines.map((line) => {
    const out: As2Token[] = []
    const push = (text: string, kind: As2TokenKind): void => void (text && out.push({ text, kind }))
    let rest = line
    if (inBlock) {
      const end = line.indexOf('*/')
      if (end < 0) return [{ text: line, kind: 'comment' }]
      push(line.slice(0, end + 2), 'comment')
      rest = line.slice(end + 2)
      inBlock = false
    }
    let at = 0
    for (const m of rest.matchAll(TOKEN)) {
      push(rest.slice(at, m.index), 'plain')
      const kind: As2TokenKind = m[1] ? 'comment' : m[2] ? 'string' : m[3] ? 'number' : 'keyword'
      push(m[0], kind)
      if (m[1]?.startsWith('/*') && !m[1].endsWith('*/')) inBlock = true
      at = m.index + m[0].length
    }
    push(rest.slice(at), 'plain')
    return out
  })
}
