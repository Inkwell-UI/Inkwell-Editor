import { describe, expect, it } from 'vitest'
import { generateGraphClasses, isAtomic } from './codegen'
import { graph, kindGraph, loadCore, node, wire } from './codegen.testutil'

const packs = await loadCore()
const gen = (...graphs: Parameters<typeof generateGraphClasses>[0]['graphs'][number][]) =>
  generateGraphClasses({ modId: 'M', swfCls: 'T', graphs, packs, layerPath: (id) => (id === 'L' ? 'title' : id === 'root' ? '' : undefined) })
const body = (src: string): string => src.split('function init() {\n')[1]!.replace(/\n    \}\n\}\n$/, '')
const count = (s: string, sub: string): number => s.split(sub).length - 1
const call = (name = 'Run', params: object[] = [{ name: 'title', type: 'String' }]) => node('e', 'core/OnWidgetCall@1', { name, params })
const numVar = [{ id: 'v1', name: 'n', type: 'Number', scope: 'menu', default: 0 }] as never

describe('golden AS2 per node kind', () => {
  for (const [id, d] of packs.defs) {
    const g = kindGraph('core', d)
    if (!g) continue
    it(id, () => {
      const r = gen(g)
      expect(r.issues).toEqual([])
      expect(body(r.classes[0]!.source)).toMatchSnapshot()
    })
  }
})

describe('class scaffolding', () => {
  const r = gen(graph('main', [call('Show', [{ name: 'title', type: 'String' }, { name: 'hold', type: 'Number' }, { name: 'on', type: 'Bool' }])], []))
  it('is a class (dynamic in practice: members are added freely) under mods.<modId> with fail and addInputHandler, and never uses Error', () => {
    const c = r.classes[0]!
    expect(c.source).toContain('class mods.M.TGraph_main {')
    expect(c.source).toContain('function fail(nodeId, e)')
    expect(c.source).toContain('function addInputHandler(action, fn)')
    expect(c.source).not.toMatch(/\bnew Error\b|\bError\(/)
    expect(c.path).toBe('__Packages/mods/M/TGraph_main.as')
  })
  it('On Widget Call: typed handler parameters and a clip method converting the string array', () => {
    const c = r.classes[0]!
    expect(c.calls).toEqual([{ name: 'Show', params: [{ name: 'title', type: 'String' }, { name: 'hold', type: 'Number' }, { name: 'on', type: 'Bool' }] }])
    expect(c.source).toContain('__g.Show = function(e_title:String, e_hold:Number, e_on:Boolean) {')
    expect(c.source).toContain('__g.base.Show = function(a) {')
    expect(c.source).toContain('a[2] == true || a[2] == "true"')
  })
  it('wraps the handler in try/catch that reports the entry node id', () => {
    expect(body(r.classes[0]!.source)).toContain('__g.fail("e", e);')
  })
})

describe('source map', () => {
  it('maps generated lines to graph node ids, scaffolding lines to nothing', () => {
    const g = graph('s', [call(), node('t', 'core/SetText@1', { target: 'L' })], [wire('e', 'then', 't', 'in')])
    const c = gen(g).classes[0]!
    const lines = c.source.split('\n')
    const at = (re: RegExp): string | undefined => c.map.lines[String(lines.findIndex((l) => re.test(l)) + 1)]
    expect(at(/__g\.base\.title\.text = /)).toBe('t')
    expect(at(/\/\/ \[t\] core\/SetText@1/)).toBe('t')
    expect(at(/__g\.fail\("e", e\)/)).toBe('e')
    expect(at(/dynamic class/)).toBeUndefined()
    expect(at(/function fail/)).toBeUndefined()
    expect(c.map).toMatchObject({ version: 1, graph: 's' })
  })
})

describe('pure node caching', () => {
  // title -> Concat(title, "") -> two Set Text
  const twice = () =>
    graph('c', [call(), node('p', 'core/Concat@1'), node('a', 'core/SetText@1', { target: 'L' }), node('b', 'core/SetText@1', { target: 'L' })], [
      wire('e', 'then', 'a', 'in'), wire('a', 'then', 'b', 'in'), wire('e', 'title', 'p', 'a'), wire('p', 'value', 'a', 'text'), wire('p', 'value', 'b', 'text')
    ])

  it('a node used twice is evaluated once, into a temp placed before its first consumer', () => {
    const out = body(gen(twice()).classes[0]!.source)
    expect(count(out, 'String(e_title)')).toBe(1)
    expect(out).toMatch(/var t_p = String\(e_title\) \+ String\(""\);/)
    expect(count(out, '.text = t_p;')).toBe(2)
    expect(out.indexOf('var t_p')).toBeLessThan(out.indexOf('.text = t_p'))
  })

  it('a node used once is inlined', () => {
    const g = graph('c', [call(), node('p', 'core/Concat@1'), node('a', 'core/SetText@1', { target: 'L' })], [wire('e', 'then', 'a', 'in'), wire('e', 'title', 'p', 'a'), wire('p', 'value', 'a', 'text')])
    const out = body(gen(g).classes[0]!.source)
    expect(out).not.toContain('var t_')
    expect(out).toContain('.text = (String(e_title) + String(""));')
  })

  it('a loop-dependent node is evaluated inside the loop body, once per iteration, and never outside it', () => {
    const g = graph('l', [
      call('Run', []), node('f', 'core/ForEach@1'), node('p', 'core/Arithmetic@1', { op: '*' }),
      node('a', 'core/SetText@1', { target: 'L' }), node('b', 'core/SetText@1', { target: 'L' }), node('t', 'core/ToString@1')
    ], [
      wire('e', 'then', 'f', 'in'), wire('f', 'body', 'a', 'in'), wire('a', 'then', 'b', 'in'),
      wire('f', 'index', 'p', 'a'), wire('p', 'value', 't', 'value'), wire('t', 'value', 'a', 'text'), wire('t', 'value', 'b', 'text')
    ])
    const out = body(gen(g).classes[0]!.source)
    const decl = out.indexOf('var t_t = ')
    expect(decl).toBeGreaterThan(out.indexOf('var f_body = function(f_item, f_index) {'))
    expect(decl).toBeLessThan(out.indexOf('for (var f_i'))
    expect(count(out, 'var t_t')).toBe(1)
    expect(count(out, '.text = t_t;')).toBe(2)
  })

  it('a volatile read (Get Variable) is never cached: each consumer reads it again, so a write in between is seen', () => {
    const g = graph('v', [call('Run', []), node('gv', 'core/GetVariable@1', { variable: 'v1' }), node('a', 'core/SetText@1', { target: 'L' }), node('w', 'core/SetVariable@1', { variable: 'v1' }), node('b', 'core/SetText@1', { target: 'L' })], [
      wire('e', 'then', 'a', 'in'), wire('a', 'then', 'w', 'in'), wire('w', 'then', 'b', 'in'),
      wire('gv', 'value', 'a', 'text'), wire('gv', 'value', 'b', 'text'), wire('gv', 'value', 'w', 'value')
    ], numVar)
    const out = body(gen(g).classes[0]!.source)
    expect(out).not.toContain('var t_')
    const reads = [...out.matchAll(/\.text = String\(__g\.v_n\);/g)].map((m) => m.index!)
    expect(reads).toHaveLength(2)
    const write = out.indexOf('__g.v_n = ', out.indexOf('Run'))
    expect(reads[0]!).toBeLessThan(write)
    expect(reads[1]!).toBeGreaterThan(write)
  })

  it('a node that depends on a volatile read is volatile too', () => {
    const g = graph('v', [call('Run', []), node('gv', 'core/GetVariable@1', { variable: 'v1' }), node('p', 'core/ToString@1'), node('a', 'core/SetText@1', { target: 'L' }), node('b', 'core/SetText@1', { target: 'L' })], [
      wire('e', 'then', 'a', 'in'), wire('a', 'then', 'b', 'in'), wire('gv', 'value', 'p', 'value'), wire('p', 'value', 'a', 'text'), wire('p', 'value', 'b', 'text')
    ], numVar)
    expect(body(gen(g).classes[0]!.source)).not.toContain('var t_p')
  })

  it('a temp made in one branch is not reused in the other branch or after it', () => {
    const g = graph('b', [
      call(), node('p', 'core/Concat@1'), node('br', 'core/Branch@1'), node('a', 'core/SetText@1', { target: 'L' }), node('b', 'core/SetText@1', { target: 'L' })
    ], [
      wire('e', 'then', 'br', 'in'), wire('br', 'true', 'a', 'in'), wire('br', 'false', 'b', 'in'), wire('e', 'title', 'p', 'a'), wire('p', 'value', 'a', 'text'), wire('p', 'value', 'b', 'text')
    ])
    const out = body(gen(g).classes[0]!.source)
    expect(count(out, 'var t_p')).toBe(2) // each branch declares its own, with distinct names
    expect(out).toContain('var t_p = ')
    expect(out).toContain('var t_p_2 = ')
  })

  it('an input the template repeats is hoisted into a temp when it is not atomic', () => {
    const g = graph('r', [call(), node('inner', 'core/Concat@1'), node('p', 'core/ToNumber@1'), node('ar', 'core/Arithmetic@1', { op: '+' }), node('a', 'core/SetText@1', { target: 'L' })], [
      wire('e', 'then', 'a', 'in'), wire('e', 'title', 'inner', 'a'), wire('inner', 'value', 'p', 'value'), wire('p', 'value', 'ar', 'a'), wire('ar', 'value', 'a', 'text')
    ])
    const out = body(gen(g).classes[0]!.source)
    expect(out).toMatch(/var t_ar_a = \(Number\(\(String\(e_title\) \+ String\(""\)\)\) \|\| 0\);/)
    expect(count(out, 't_ar_a')).toBe(3)
  })
})

describe('safety and errors', () => {
  it('a field written as code (raw) must be an allowed value: an operator outside the enum is refused, the rest of the graph still compiles', () => {
    const g = graph('x', [call(), node('p', 'core/Arithmetic@1', { op: '+ 1; trace("x") //' }), node('a', 'core/SetText@1', { target: 'L' }), node('l', 'core/Log@1', { level: 'info' })], [
      wire('e', 'then', 'a', 'in'), wire('a', 'then', 'l', 'in'), wire('p', 'value', 'a', 'text')
    ])
    const r = gen(g)
    expect(r.issues[0]!.message).toContain('"op"')
    expect(r.classes[0]!.source).not.toContain('trace("x")')
    expect(r.classes[0]!.source).toContain('skipped')
  })
  it('a target layer that is not compiled skips the node and reports it', () => {
    const r = gen(graph('x', [call(), node('a', 'core/SetText@1', { target: 'gone' })], [wire('e', 'then', 'a', 'in')]))
    expect(r.issues).toHaveLength(1)
    expect(r.issues[0]).toMatchObject({ nodeId: 'a', graphId: 'x' })
  })
  it('an unknown node kind becomes a comment, not a crash', () => {
    const r = gen(graph('x', [call(), node('u', 'other/Thing@1')], [wire('e', 'then', 'u', 'in')]))
    expect(r.issues[0]!.message).toContain('Unknown node kind')
  })
  it('an exec cycle is cut', () => {
    const r = gen(graph('x', [call(), node('a', 'core/Log@1'), node('b', 'core/Log@1')], [wire('e', 'then', 'a', 'in'), wire('a', 'then', 'b', 'in'), wire('b', 'then', 'a', 'in')]))
    expect(r.issues.some((i) => i.message.includes('loops back'))).toBe(true)
  })
  it('node ids with quotes cannot break out of strings', () => {
    const g = graph('x', [call(), node('a"b', 'core/Log@1', { level: 'info' })], [wire('e', 'then', 'a"b', 'in')])
    expect(gen(g).classes[0]!.source).not.toContain('a"b')
  })
  it('two graphs get two classes with distinct names', () => {
    const r = gen(graph('a-b', [call()], []), graph('a_b', [call()], []))
    expect(r.classes.map((c) => c.cls)).toEqual(['TGraph_a_b', 'TGraph_a_b_2'])
  })
})

describe('isAtomic', () => {
  it.each(['x', '__g.v_a', '12', '-1', '"a b"', '[]', '(a + b)', 'Number(a + b)', 'x.y.z(1)'])('%s is atomic', (s) => expect(isAtomic(s)).toBe(true))
  it.each(['a + b', '(a) + (b)', 'a ? b : c', '!a', 'f(x) + 1', '"a" + "b"'])('%s is not', (s) => expect(isAtomic(s)).toBe(false))
})
