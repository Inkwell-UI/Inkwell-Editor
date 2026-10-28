// Functions (docs/functions.md): a function graph compiles to its own class, one instance per call; Call Function passes one closure per exit; the validator checks the signature.
import type { Graph } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { validateGraph } from '../../shared/graphValidate'
import { frame, swf } from '../swf/ir.testutil'
import { generate } from '../swf/generate'
import { generateGraphClasses } from './codegen'
import { graph, loadCore, node, wire } from './codegen.testutil'

const packs = await loadCore()
const sig: NonNullable<Graph['signature']> = {
  inputs: [{ id: 'i1', name: 'title', type: 'String' }],
  outputs: [{ id: 'o1', name: 'count', type: 'Number' }],
  exits: [{ id: 'x1', name: 'Done' }, { id: 'x2', name: 'Failed' }]
}

/** greet(title) -> Delay -> Branch(false): Failed; the Done exit is reached through the true arm. count = ToNumber(title). */
const greet = (over: Partial<Graph> = {}): Graph =>
  ({
    ...graph('greet', [
      node('fe', 'core/FunctionEntry@1'),
      node('d', 'core/Delay@1', { name: 'wait' }),
      node('br', 'core/Branch@1'),
      node('ok', 'core/FunctionExit@1', { exit: 'x1' }),
      node('no', 'core/FunctionExit@1', { exit: 'x2' }),
      node('num', 'core/ToNumber@1')
    ], [
      wire('fe', 'then', 'd', 'in'), wire('d', 'then', 'br', 'in'), wire('br', 'true', 'ok', 'in'), wire('br', 'false', 'no', 'in'),
      wire('fe', 'title', 'num', 'value'), wire('num', 'value', 'ok', 'count')
    ]),
    name: 'Greet', scope: 'function', signature: sig, ...over
  }) as Graph

const callNode = (fields: Record<string, unknown> = {}) =>
  node('c', 'core/CallFunction@1', { function: 'greet', inputs: sig.inputs, outputs: sig.outputs, exits: sig.exits, title: '42', ...fields })
const caller = (): Graph =>
  graph('main', [
    node('run', 'core/OnWidgetCall@1', { name: 'Run', params: [] }),
    callNode(),
    node('ts', 'core/ToString@1'),
    node('log', 'core/Log@1', { level: 'info' }),
    node('lf', 'core/Log@1', { level: 'warn', message: 'failed' })
  ], [wire('run', 'then', 'c', 'in'), wire('c', 'Done', 'log', 'in'), wire('c', 'count', 'ts', 'value'), wire('ts', 'value', 'log', 'message'), wire('c', 'Failed', 'lf', 'in')])

const gen = (...graphs: Graph[]) => generateGraphClasses({ modId: 'M', swfCls: 'T', graphs, packs, layerPath: () => undefined })

describe('codegen', () => {
  const r = gen(caller(), greet())
  const [main, fn] = r.classes as [(typeof r.classes)[number], (typeof r.classes)[number]]

  it('compiles both graphs without issues; only the function class is flagged', () => {
    expect(r.issues).toEqual([])
    expect(main.fn).toBeUndefined()
    expect(fn.fn).toBe(true)
  })

  it('the function is a class created per call: constructor takes base, owner and the exits, run takes the signature inputs', () => {
    expect(fn.source).toContain('class mods.M.TGraph_greet {')
    expect(fn.source).toContain('function TGraph_greet(base, owner, exits) {')
    expect(fn.source).toContain('function run(fe_title:String) {')
    expect(fn.source).not.toContain('function init()')
    expect(fn.source).not.toContain('addInputHandler')
  })

  it('the Delay and the exits live in the body; Function Exit calls the closure with the output value', () => {
    expect(fn.source).toContain('setInterval(function() {')
    expect(fn.source).toContain('__g.exits.Done((Number(fe_title) || 0));')
    expect(fn.source).toContain('__g.exits.Failed(0);')
  })

  it('the call creates a new instance, passes one closure per exit and reads the output as a closure parameter', () => {
    expect(main.source).toContain('(new mods.M.TGraph_greet(__g.base, __g, {')
    expect(main.source).toContain('Done: function(c_count:Number) {')
    expect(main.source).toContain('Failed: function(c_count:Number) {')
    expect(main.source).toContain('})).run("42");')
    expect(main.source).toContain('String(c_count)') // the output wired on to ToString
  })

  it('a function name that is not a plain identifier skips the function and reports it', () => {
    const bad = gen(caller(), greet({ signature: { ...sig, inputs: [{ id: 'i1', name: 'my title', type: 'String' }] } }))
    expect(bad.issues.some((x) => x.message.includes('plain identifier'))).toBe(true)
  })

  it('source map lines of a function point at its nodes', () => {
    expect(Object.values(fn.map.lines)).toContain('ok')
    expect(Object.values(main.map.lines)).toContain('c')
  })
})

describe('swf generation', () => {
  it('the frame code starts only the graph, never the function class (Call Function creates it)', () => {
    const g = generate(swf([frame('f', [])], { id: 't' }), { modId: 'M', graphs: { graphs: [caller(), greet()], packs } })
    expect(g.graphClasses.map((c) => c.cls)).toEqual(['TGraph_main', 'TGraph_greet'])
    const code = g.as2.map((a) => a.source).join('\n')
    expect(g.as2.some((a) => a.path.endsWith('TGraph_greet.as'))).toBe(true)
    expect(code).not.toContain('new mods.M.TGraph_greet(root')
  })
})

describe('validation', () => {
  const defs = packs.defs
  const check = (g: Graph, siblings: Graph[] = []) => validateGraph(g, { defs, siblings }).filter((i) => i.code === 'graph-function')
  const msgs = (g: Graph, siblings: Graph[] = []) => check(g, siblings).map((i) => i.message)

  it('a correct function and its caller have no function issues', () => {
    expect(check(greet(), [caller()])).toEqual([])
    expect(check(caller(), [greet()])).toEqual([])
  })

  it('the call must name a function of the SWF', () => {
    expect(msgs(caller())).toEqual([expect.stringContaining('no function graph "greet"')])
    const g = caller()
    g.nodes = g.nodes.map((n) => (n.id === 'c' ? callNode({ function: '' }) : n))
    expect(msgs(g, [greet()])).toEqual([expect.stringContaining('Pick the function')])
  })

  it('a changed signature makes the copy in the call stale (matched by id, name and type)', () => {
    const renamed = greet({ signature: { ...sig, outputs: [{ id: 'o1', name: 'total', type: 'Number' }] } })
    expect(msgs(caller(), [renamed])).toEqual([expect.stringContaining('changed since this call was made')])
  })

  it('Function Entry and Exit only work in a function graph; a function needs one entry and exits that exist', () => {
    const menu = graph('m', [node('fe', 'core/FunctionEntry@1'), node('ok', 'core/FunctionExit@1', { exit: 'x1' })], [])
    expect(msgs(menu)).toHaveLength(2)
    const noEntry = greet()
    noEntry.nodes = noEntry.nodes.filter((n) => n.id !== 'fe')
    expect(msgs(noEntry).some((m) => m.includes('needs a Function Entry'))).toBe(true)
    const twoEntries = greet()
    twoEntries.nodes.push(node('fe2', 'core/FunctionEntry@1'))
    expect(msgs(twoEntries)).toContainEqual(expect.stringContaining('one Function Entry'))
    const badExit = greet()
    badExit.nodes = badExit.nodes.map((n) => (n.id === 'no' ? node('no', 'core/FunctionExit@1', { exit: 'zzz' }) : n))
    expect(msgs(badExit)).toContainEqual(expect.stringContaining('does not name an exit'))
  })

  it('an event cannot start a function', () => {
    const g = greet()
    g.nodes.push(node('ev', 'core/OnWidgetCall@1', { name: 'Run', params: [] }))
    expect(msgs(g)).toContainEqual(expect.stringContaining('is an event'))
  })

  it('an exit without a Function Exit node is a warning; reserved and non-identifier names are errors', () => {
    const g = greet()
    g.nodes = g.nodes.filter((n) => n.id !== 'no')
    g.edges = g.edges.filter((e) => e.to.node !== 'no')
    expect(check(g).filter((i) => i.level === 'warning')).toHaveLength(1)
    const reserved = greet({ signature: { ...sig, inputs: [{ id: 'i1', name: 'exits', type: 'String' }] } })
    expect(msgs(reserved)).toContainEqual(expect.stringContaining('reserved'))
    const overlap = greet({ signature: { ...sig, outputs: [{ id: 'o1', name: 'Done', type: 'Number' }] } })
    expect(msgs(overlap)).toContainEqual(expect.stringContaining('both an output and an exit'))
  })

  it('a function that calls itself, directly or through another function, is refused', () => {
    const selfCall = greet()
    selfCall.nodes.push(node('self', 'core/CallFunction@1', { function: 'greet', inputs: sig.inputs, outputs: sig.outputs, exits: sig.exits }))
    expect(msgs(selfCall)).toContainEqual(expect.stringContaining('leads back into'))
    const a = greet({ id: 'a', name: 'A' })
    const b = greet({ id: 'b', name: 'B' })
    a.nodes.push(node('toB', 'core/CallFunction@1', { function: 'b', inputs: sig.inputs, outputs: sig.outputs, exits: sig.exits }))
    b.nodes.push(node('toA', 'core/CallFunction@1', { function: 'a', inputs: sig.inputs, outputs: sig.outputs, exits: sig.exits }))
    expect(msgs(a, [b])).toContainEqual(expect.stringContaining('leads back into'))
    // a plain chain is fine
    expect(msgs(a, [greet({ id: 'b', name: 'B' })])).toEqual([])
  })

  it('functions in different graphs are not duplicate event handlers', () => {
    const dup = validateGraph(greet({ id: 'a' }), { defs, siblings: [greet({ id: 'b' })] }).filter((i) => i.code === 'graph-duplicate-handler')
    expect(dup).toEqual([])
  })
})
