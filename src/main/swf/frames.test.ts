import { describe, expect, it } from 'vitest'
import type { Node } from '@inkwell-ui/spec'
import { generate } from './generate'
import { frame, swf, textNode } from './ir.testutil'
import { parseSwf, parseTags, readPlace, type RawTag } from './swfReader.testutil'
import { TAG, writeSwf } from './tags'

const gen = (nodes: Node[]) => generate(swf(nodes, { id: 'frames' }), { modId: 'MyMod' })
const tagsOf = (g: ReturnType<typeof gen>) => parseSwf(writeSwf({ widthPx: 1920, heightPx: 1080, tags: g.tags })).tags
const codes = (l: ReturnType<typeof gen>['lint']) => l.map((i) => [i.severity, i.code, i.nodeId])
const red = { type: 'solid', color: { r: 1, g: 0, b: 0 } }
/** The tags inside each DefineSprite. */
const sprites = (g: ReturnType<typeof gen>): RawTag[][] => tagsOf(g).filter((t) => t.code === TAG.DefineSprite).map((t) => parseTags(t.body.subarray(4)))
const placesIn = (tags: RawTag[]) => tags.filter((t) => t.code === TAG.PlaceObject2)

describe('nested frames: fills and clip content', () => {
  it('a solid fill is a rectangle shape named fill under the children, in the frame size', () => {
    const g = gen([frame('f', ['g']), frame('g', ['t'], { fills: [red] }), textNode('t')])
    expect(codes(g.lint)).toEqual([])
    expect(g.shapes.map((s) => s.nodeId)).toEqual(['g'])
    expect(g.shapes[0]!.svg).toContain('fill="#ff0000"')
    expect(g.shapes[0]!.svg).toContain('<rect width="100" height="40"')
    const names = sprites(g).flatMap((s) => placesIn(s).map((t) => readPlace(t).name))
    expect(names).toContain('fill')
    expect(names.indexOf('fill')).toBeLessThan(names.indexOf('text_t'))
  })

  it('two fills stack as fill and fill_2; a gradient is its first stop with a warning', () => {
    const grad = { type: 'linear', stops: [{ position: 0, color: { r: 0, g: 1, b: 0 } }, { position: 1, color: { r: 0, g: 0, b: 1 } }] }
    const g = gen([frame('f', ['g']), frame('g', [], { fills: [red, grad] })])
    expect(g.shapes).toHaveLength(2)
    expect(g.shapes[1]!.svg).toContain('fill="#00ff00"')
    expect(codes(g.lint)).toEqual([['warning', 'fill-gradient-approximated', 'g']])
  })

  it('the root frame stays transparent: its solid fill is skipped with an info', () => {
    const g = gen([frame('f', [], { fills: [red] })])
    expect(g.shapes).toEqual([])
    expect(codes(g.lint)).toEqual([['info', 'frame-fill-root-skipped', 'f']])
  })

  it('clipContent puts a clip layer at depth 1 that covers every placement above it', () => {
    const g = gen([frame('f', ['g']), frame('g', ['t'], { clipContent: true, fills: [red] }), textNode('t')])
    expect(codes(g.lint)).toEqual([])
    expect(g.shapes.map((s) => s.nodeId)).toEqual(['g', 'g']) // the fill and the mask
    const clips = sprites(g).flatMap((s) => placesIn(s)).filter((t) => t.body[0]! & 0x40)
    expect(clips).toHaveLength(1)
    const c = clips[0]!
    expect(readPlace(c).depth).toBe(1)
    expect(c.body.readUInt16LE(c.body.length - 2)).toBe(3) // mask 1, fill 2, text 3: the clip layer reaches depth 3
  })

  it('a frame without clipContent has no clip layer', () => {
    const g = gen([frame('f', ['g']), frame('g', ['t']), textNode('t')])
    expect(sprites(g).flatMap((s) => placesIn(s)).filter((t) => t.body[0]! & 0x40)).toHaveLength(0)
  })
})
