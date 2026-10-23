// Test-only IR builders (plain objects typed as the spec's Swf/Node).
import type { Node, Swf } from '@inkwell-ui/spec'

const base = (id: string, name: string, parent: string | null, children: string[], x = 0, y = 0, width = 100, height = 40) => ({
  id, name, parent, children,
  transform: { x, y, width, height, rotation: 0 },
  anchor: { h: 'left' as const, v: 'top' as const },
  visible: true,
  opacity: 1
})

export const frame = (id: string, children: string[], over: Record<string, unknown> = {}): Node =>
  ({ ...base(id, `frame ${id}`, null, children), type: 'frame', clipContent: false, ...over }) as Node

export const rectShape = (id: string, over: Record<string, unknown> = {}): Node =>
  ({
    ...base(id, `rect ${id}`, null, [], 10, 20, 200, 50),
    type: 'shape',
    paths: [[{ op: 'M', x: 0, y: 0 }, { op: 'L', x: 200, y: 0 }, { op: 'L', x: 200, y: 50 }, { op: 'L', x: 0, y: 50 }, { op: 'Z' }]],
    fills: [{ type: 'solid', color: { r: 1, g: 0, b: 0 } }],
    strokes: [],
    ...over
  }) as Node

export const textNode = (id: string, over: Record<string, unknown> = {}, font = 'Everywhere / Medium / 18'): Node =>
  ({
    ...base(id, `text ${id}`, null, [], 5, 6, 120, 30),
    type: 'text',
    content: 'Hello',
    sizing: 'fixed',
    runs: [{ start: 0, end: 5, font: { kind: 'alias', name: font }, size: 18, fill: { type: 'solid', color: { r: 1, g: 0.5, b: 0 } } }],
    ...over
  }) as Node

export function swf(nodes: Node[], over: Record<string, unknown> = {}): Swf {
  return {
    specVersion: 1, id: 'test', name: 'Test', target: { kind: 'hudWidget' }, stage: { width: 1920, height: 1080 },
    root: nodes[0]!.id,
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    ...over
  } as Swf
}
