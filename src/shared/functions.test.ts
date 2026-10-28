import type { Graph } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { generateGraphClasses } from '../main/codegen/codegen'
import { graph, loadCore, node, wire } from '../main/codegen/codegen.testutil'
import { applySignature, callFields, extractFunction, newCallNode, newFunctionGraph, refreshCall, refreshCalls, staleCalls, type Signature } from './functions'
import { validateGraph } from './graphValidate'

const packs = await loadCore()
const defs = packs.defs
let seq = 0
const ids = () => `id${++seq}`
const issues = (g: Graph, siblings: Graph[] = []) => validateGraph(g, { defs, siblings }).filter((i) => i.level === 'error')

/** OnLoad -> Delay -> Log(message <- ToString <- Add) -> Log(after) */
const menu = (): Graph =>
  graph('main', [
    node('ol', 'core/OnLoad@1'), node('d', 'core/Delay@1'), node('l', 'core/Log@1', { level: 'info' }), node('after', 'core/Log@1', { level: 'info', message: 'after' }),
    node('ts', 'core/ToString@1'), node('add', 'core/Add@1')
  ], [wire('ol', 'then', 'd', 'in'), wire('d', 'then', 'l', 'in'), wire('l', 'then', 'after', 'in'), wire('add', 'value', 'ts', 'value'), wire('ts', 'value', 'l', 'message')])

describe('newFunctionGraph', () => {
  it('is a valid function with Entry wired to an Exit', () => {
    const fn = newFunctionGraph('f', 'F', ids)
    expect(fn.scope).toBe('function')
    expect(fn.signature?.exits).toHaveLength(1)
    expect(issues(fn)).toEqual([])
  })
})

describe('extractFunction', () => {
  it('moves the nodes into a function and rewires the caller through the boundary pins', () => {
    const g = menu()
    const r = extractFunction(g, new Set(['d', 'l']), defs, { id: 'wait-log', name: 'Wait Log', callId: 'call', newId: ids })
    if (!r.ok) throw new Error(r.error)
    const sig = r.fn.signature as Signature
    expect(sig.inputs.map((p) => `${p.name}:${p.type}`)).toEqual(['message:String'])
    expect(sig.outputs).toEqual([])
    expect(sig.exits.map((x) => x.name)).toEqual(['then'])
    // function: Entry -> d -> l -> Exit(then); the message comes from the Entry
    const feId = r.fn.nodes.find((n) => n.kind.includes('FunctionEntry'))!.id
    expect(r.fn.edges).toContainEqual(expect.objectContaining({ from: { node: feId, pin: 'message' }, to: { node: 'l', pin: 'message' } }))
    expect(r.fn.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['d', 'l']))
    // caller: the moved nodes are gone, one call stands in their place
    expect(r.caller.nodes.map((n) => n.id).sort()).toEqual(['add', 'after', 'call', 'ol', 'ts'])
    expect(r.caller.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: { node: 'ol', pin: 'then' }, to: { node: 'call', pin: 'in' } }),
      expect.objectContaining({ from: { node: 'ts', pin: 'value' }, to: { node: 'call', pin: 'message' } }),
      expect.objectContaining({ from: { node: 'call', pin: 'then' }, to: { node: 'after', pin: 'in' } })
    ]))
    // both graphs are valid and compile without issues
    expect(issues(r.fn, [r.caller])).toEqual([])
    expect(issues(r.caller, [r.fn])).toEqual([])
    const out = generateGraphClasses({ modId: 'M', swfCls: 'T', graphs: [r.caller, r.fn], packs, layerPath: () => undefined })
    expect(out.issues).toEqual([])
  })

  it('a value used outside becomes an output; the Exit node supplies it', () => {
    const g = graph('main', [node('ol', 'core/OnLoad@1'), node('ctr', 'core/Counter@1', { name: 'c', action: 'increment' }), node('after', 'core/Log@1', { level: 'info' }), node('ts', 'core/ToString@1')],
      [wire('ol', 'then', 'ctr', 'in'), wire('ctr', 'then', 'after', 'in'), wire('ctr', 'value', 'ts', 'value'), wire('ts', 'value', 'after', 'message')])
    const r = extractFunction(g, new Set(['ctr']), defs, { id: 'count', name: 'Count', callId: 'call', newId: ids })
    if (!r.ok) throw new Error(r.error)
    expect(r.fn.signature?.outputs.map((p) => `${p.name}:${p.type}`)).toEqual(['value:Number'])
    const exit = r.fn.nodes.find((n) => n.kind.includes('FunctionExit'))!
    expect(r.fn.edges).toContainEqual(expect.objectContaining({ from: { node: 'ctr', pin: 'value' }, to: { node: exit.id, pin: 'value' } }))
    expect(r.caller.edges).toContainEqual(expect.objectContaining({ from: { node: 'call', pin: 'value' }, to: { node: 'ts', pin: 'value' } }))
    expect(issues(r.fn, [r.caller])).toEqual([])
    expect(issues(r.caller, [r.fn])).toEqual([])
  })

  it('with no exec wire leaving, the flow ends in one "Done" exit', () => {
    const g = graph('main', [node('ol', 'core/OnLoad@1'), node('l', 'core/Log@1', { level: 'info', message: 'x' })], [wire('ol', 'then', 'l', 'in')])
    const r = extractFunction(g, new Set(['l']), defs, { id: 'f', name: 'F', callId: 'call', newId: ids })
    if (!r.ok) throw new Error(r.error)
    expect(r.fn.signature?.exits.map((x) => x.name)).toEqual(['Done'])
    expect(issues(r.fn, [r.caller])).toEqual([])
  })

  it('refuses events, graph variables, several entry points and a selection nothing starts', () => {
    const g = menu()
    const why = (sel: string[], graphOverride: Graph = g) => {
      const r = extractFunction(graphOverride, new Set(sel), defs, { id: 'f', name: 'F', callId: 'c', newId: ids })
      return r.ok ? 'ok' : r.error
    }
    expect(why(['ol', 'd'])).toContain('is an event')
    expect(why([])).toContain('Select the nodes')
    expect(why(['ts', 'add'])).toContain('Nothing connects')
    expect(why(['d', 'after'])).toContain('more than one place')
    const withVar = { ...menu(), variables: [{ id: 'v1', name: 'count', type: 'Number', scope: 'menu', default: 0 }] } as Graph
    withVar.nodes.push(node('sv', 'core/SetVariable@1', { variable: 'v1' }))
    withVar.edges.push(wire('d', 'then', 'sv', 'in'))
    expect(why(['d', 'sv'], withVar)).toContain('graph variable "count"')
  })

  it('names are plain identifiers, never the reserved call field names, and unique', () => {
    const g = graph('main', [node('ol', 'core/OnLoad@1'), node('l', 'core/Log@1', { level: 'info' }), node('a', 'core/ToString@1'), node('b', 'core/ToString@1')],
      [wire('ol', 'then', 'l', 'in'), wire('a', 'value', 'l', 'message')])
    const r = extractFunction(g, new Set(['l']), defs, { id: 'f', name: 'F', callId: 'c', newId: ids })
    if (!r.ok) throw new Error(r.error)
    expect(r.fn.signature?.inputs.map((p) => p.name)).toEqual(['message'])
  })
})

describe('calls follow the signature', () => {
  const base = (): { fn: Graph; caller: Graph } => {
    const r = extractFunction(menu(), new Set(['d', 'l']), defs, { id: 'wl', name: 'WL', callId: 'call', newId: ids })
    if (!r.ok) throw new Error(r.error)
    return { fn: r.fn, caller: r.caller }
  }

  it('a fresh call is not stale; a changed signature makes it stale', () => {
    const { fn, caller } = base()
    expect(staleCalls(caller, fn)).toEqual([])
    const changed = applySignature(fn, { ...fn.signature!, inputs: fn.signature!.inputs.map((p) => ({ ...p, name: 'text' })) })
    expect(staleCalls(caller, changed)).toEqual(['call'])
  })

  it('renaming an input keeps the wires of the function and of every call, by pin id', () => {
    const { fn, caller } = base()
    const next: Signature = { ...fn.signature!, inputs: fn.signature!.inputs.map((p) => ({ ...p, name: 'text' })), exits: fn.signature!.exits.map((x) => ({ ...x, name: 'finished' })) }
    const changed = applySignature(fn, next)
    const feId = changed.nodes.find((n) => n.kind.includes('FunctionEntry'))!.id
    expect(changed.edges).toContainEqual(expect.objectContaining({ from: { node: feId, pin: 'text' }, to: { node: 'l', pin: 'message' } }))
    const refreshed = refreshCalls(caller, changed)
    expect(refreshed.edges).toContainEqual(expect.objectContaining({ from: { node: 'ts', pin: 'value' }, to: { node: 'call', pin: 'text' } }))
    expect(refreshed.edges).toContainEqual(expect.objectContaining({ from: { node: 'call', pin: 'finished' }, to: { node: 'after', pin: 'in' } }))
    expect(staleCalls(refreshed, changed)).toEqual([])
    expect(issues(changed, [refreshed])).toEqual([])
    expect(issues(refreshed, [changed])).toEqual([])
  })

  it('removing a pin drops its wires; a typed-in value follows a rename', () => {
    const { fn } = base()
    const call = newCallNode(fn, 'c2', 0, 0)
    call.fields['message'] = 'hello'
    const g = graph('other', [call, node('x', 'core/Log@1', { level: 'info' })], [wire('c2', 'then', 'x', 'in')])
    const renamed = applySignature(fn, { ...fn.signature!, inputs: fn.signature!.inputs.map((p) => ({ ...p, name: 'text' })) })
    const a = refreshCall(g, 'c2', renamed)
    expect(a.nodes.find((n) => n.id === 'c2')!.fields['text']).toBe('hello')
    expect(a.nodes.find((n) => n.id === 'c2')!.fields['message']).toBeUndefined()
    const removed = applySignature(fn, { ...fn.signature!, exits: [{ id: 'new-exit', name: 'other' }] })
    const b = refreshCall(g, 'c2', removed)
    expect(b.edges).toEqual([]) // the wire left the removed exit "then"
    expect(Object.keys(callFields(removed))).toEqual(['function', 'inputs', 'outputs', 'exits'])
  })
})
