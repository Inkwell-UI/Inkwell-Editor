// Tests for the "more nodes" group (Random and Counter caching, Toggle bindings, retriggerable Delay, Cancel Delay, Tween registry). Per-kind goldens are in codegen.test.ts.
import { describe, expect, it } from 'vitest'
import { generateGraphClasses } from './codegen'
import { graph, loadCore, node, wire } from './codegen.testutil'

const packs = await loadCore()
const gen = (g: Parameters<typeof generateGraphClasses>[0]['graphs'][number], bindings?: Record<string, string>) =>
  generateGraphClasses({ modId: 'M', swfCls: 'T', graphs: [g], packs, bindings, layerPath: (id) => (id === 'L' ? 'title' : undefined) })
const body = (src: string): string => src.split('function init() {\n')[1]!.replace(/\n    \}\n\}\n$/, '')
const count = (s: string, sub: string): number => s.split(sub).length - 1
const entry = node('e', 'core/OnWidgetCall@1', { name: 'Run', params: [] })
const setText = (id: string) => node(id, 'core/SetText@1', { target: 'L' })

describe('Random is volatile', () => {
  it('two consumers each draw their own number: never cached into a temp', () => {
    const g = graph('r', [entry, node('r', 'core/Random@1', { }), setText('a'), setText('b')], [
      wire('e', 'then', 'a', 'in'), wire('a', 'then', 'b', 'in'), wire('r', 'value', 'a', 'text'), wire('r', 'value', 'b', 'text')
    ])
    const r = gen(g)
    expect(r.issues).toEqual([])
    const out = body(r.classes[0]!.source)
    expect(out).not.toContain('var t_')
    expect(count(out, '({ f: function(a, b, i)')).toBe(2)
  })
  it('a node fed by Random is volatile too', () => {
    const g = graph('r', [entry, node('r', 'core/Random@1'), node('p', 'core/Round@1'), setText('a'), setText('b')], [
      wire('e', 'then', 'a', 'in'), wire('a', 'then', 'b', 'in'), wire('r', 'value', 'p', 'value'), wire('p', 'value', 'a', 'text'), wire('p', 'value', 'b', 'text')
    ])
    const out = body(gen(g).classes[0]!.source)
    expect(out).not.toContain('var t_')
    expect(count(out, '({ f: function(a, b, i)')).toBe(2)
  })
})

describe('Counter', () => {
  // Counter c1 -> Set Text a (ToString p of c1.value) -> Counter c2 -> Set Text b (same p): p is an ordinary pure node on a local, cached once
  const g = () =>
    graph('c', [entry, node('c1', 'core/Counter@1', { name: 'n', action: 'increment' }), node('c2', 'core/Counter@1', { name: 'n', action: 'increment' }), node('p', 'core/ToString@1'), setText('a'), setText('b')], [
      wire('e', 'then', 'c1', 'in'), wire('c1', 'then', 'a', 'in'), wire('a', 'then', 'c2', 'in'), wire('c2', 'then', 'b', 'in'),
      wire('c1', 'value', 'p', 'value'), wire('p', 'value', 'a', 'text'), wire('p', 'value', 'b', 'text')
    ])
  it('its value is a local of the run; a pure node reading it is hoisted once, after the Counter statement', () => {
    const r = gen(g())
    expect(r.issues).toEqual([])
    const out = body(r.classes[0]!.source)
    expect(out).toMatch(/var c1_value = Number\(__g\.ctr\["n"\]\) \|\| 0;/)
    expect(count(out, 'var t_p = String(c1_value);')).toBe(1)
    expect(out.indexOf('var c1_value')).toBeLessThan(out.indexOf('var t_p'))
    expect(count(out, '.text = t_p;')).toBe(2)
    expect(out).toContain('__g.ctr["n"] += 1;')
  })
  it('same-named Counter nodes share state; increment, reset and get differ only in the statement', () => {
    const out = body(gen(graph('c', [entry, node('r', 'core/Counter@1', { name: 'n', action: 'reset' }), node('g', 'core/Counter@1', { name: 'n', action: 'get' })], [wire('e', 'then', 'r', 'in'), wire('r', 'then', 'g', 'in')])).classes[0]!.source)
    expect(out).toContain('if ("reset" == "increment")')
    expect(count(out, '__g.ctr["n"]')).toBeGreaterThan(4)
  })
})

describe('Toggle', () => {
  it('flips the variable and refreshes its bindings like Set Variable', () => {
    const g = graph('t', [entry, node('t', 'core/Toggle@1', { variable: 'v1' }), setText('a')], [wire('e', 'then', 't', 'in'), wire('t', 'then', 'a', 'in'), wire('t', 'value', 'a', 'text')],
      [{ id: 'v1', name: 'flag', type: 'Bool', scope: 'menu', default: false }] as never)
    const r = gen(g, { L: 'visible=var:v1' })
    expect(r.issues).toEqual([])
    const out = body(r.classes[0]!.source)
    expect(out).toContain('__g.v_flag = !(__g.v_flag == true);')
    expect(out.indexOf('__g.b_flag();', out.indexOf('Toggle'))).toBeGreaterThan(out.indexOf('__g.v_flag = !('))
  })
})

describe('Delay retriggers; Cancel Delay and Stop Timer find timers by name', () => {
  const g = graph('d', [entry, node('w', 'core/Delay@1', { name: 'hold' }), node('x', 'core/CancelDelay@1', { name: 'hold' }), setText('a'), node('tm', 'core/OnTimer@1', { name: 'tick' }), node('st', 'core/StopTimer@1', { name: 'tick' }), setText('b')],
    [wire('e', 'then', 'w', 'in'), wire('w', 'then', 'a', 'in'), wire('tm', 'then', 'st', 'in'), wire('st', 'then', 'b', 'in')])
  const out = body(gen(g).classes[0]!.source)
  it('golden AS2', () => expect(out).toMatchSnapshot())
  it('an entry clears the pending timer of the same key before it starts a new one, and the callback clears its own', () => {
    expect(out.indexOf('clearInterval(__g.dl[w_k]);')).toBeLessThan(out.indexOf('__g.dl[w_k] = setInterval('))
    expect(out).toContain('var w_k = ("hold" == "" ? "w" : "hold");')
    expect(count(out, 'clearInterval(__g.dl[w_k]);')).toBe(2)
  })
  it('Cancel Delay and Stop Timer clear by the same names; On Timer registers its id', () => {
    const cancel = gen(graph('d2', [entry, node('x', 'core/CancelDelay@1', { name: 'hold' })], [wire('e', 'then', 'x', 'in')])).classes[0]!.source
    expect(cancel).toContain('clearInterval(__g.dl["hold"]);')
    expect(out).toContain('clearInterval(__g.tm["tick"]);')
    expect(out).toContain('__g.tm["tick" == "" ? "tm" : "tick"] = __g.t_tm;')
  })
  it('the unnamed Delay falls back to its node id', () => {
    const o = body(gen(graph('d3', [entry, node('w2', 'core/Delay@1')], [wire('e', 'then', 'w2', 'in')])).classes[0]!.source)
    expect(o).toContain('var w2_k = ("" == "" ? "w2" : "");')
  })
})

describe('Tween', () => {
  it('registers its record in __g.tw (replacing a running tween of the same target and property) and Stop Tweens clears by target', () => {
    const g = graph('tw', [entry, node('t', 'core/Tween@1', { target: 'L', property: 'scale', easing: 'easeInOut' }), node('s', 'core/StopTweens@1', { target: 'L' })], [wire('e', 'then', 't', 'in'), wire('t', 'then', 's', 'in')])
    const r = gen(g)
    expect(r.issues).toEqual([])
    const out = body(r.classes[0]!.source)
    expect(out).toContain('var t_pr = "scale";')
    expect(out).toContain('__g.tw.push(t_rec);')
    expect(out).toContain('if (__g.tw[s_i].t == __g.base.title) {')
  })
  it('a property field is written as an escaped string literal, never as code', () => {
    const r = gen(graph('tw', [entry, node('t', 'core/Tween@1', { target: 'L', property: 'x"; trace("x"); //' })], [wire('e', 'then', 't', 'in')]))
    expect(r.classes[0]!.source).not.toContain('trace("x")')
  })
})

describe('untyped items', () => {
  it('Array Get coerces to the chosen valueType and a wire of that type is accepted', () => {
    const g = graph('a', [entry, node('g', 'core/ArrayGet@1', { valueType: 'Number' }), setText('a')], [wire('e', 'then', 'a', 'in'), wire('g', 'value', 'a', 'text')])
    const r = gen(g)
    expect(r.issues).toEqual([])
    expect(body(r.classes[0]!.source)).toContain('}).f([][0], "Number")')
  })
})

describe('keyed Set Text in a menu (V13.2)', () => {
  const genMenu = (g: Parameters<typeof generateGraphClasses>[0]['graphs'][number], menu = true) =>
    generateGraphClasses({ modId: 'M', swfCls: 'T', graphs: [g], packs, layerPath: (id) => (id === 'L' ? 'title' : undefined), ...(menu ? { menu: true } : {}) })
  it('a $KEY literal and a wired text go through __g.tr; a plain literal does not; a widget never', () => {
    const g = graph('k', [entry, node('a', 'core/SetText@1', { target: 'L', text: '$Inkwell_M_Start' }), node('b', 'core/SetText@1', { target: 'L', text: 'plain' }), node('c', 'core/SetText@1', { target: 'L' }), node('s', 'core/Concat@1')],
      [wire('e', 'then', 'a', 'in'), wire('a', 'then', 'b', 'in'), wire('b', 'then', 'c', 'in'), wire('s', 'value', 'c', 'text')])
    const r = genMenu(g)
    expect(r.issues).toEqual([])
    const src = r.classes[0]!.source
    expect(src).toContain('__g.base.title.text = __g.tr("$Inkwell_M_Start");')
    expect(src).toContain('__g.base.title.text = "plain";')
    expect(count(src, '__g.tr(')).toBe(2)
    expect(src).toContain('    function tr(s) {')
    expect(genMenu(g, false).classes[0]!.source).not.toContain('__g.tr(')
  })
})

describe('auto layout hook', () => {
  const g = graph('f', [entry, node('a', 'core/SetText@1', { target: 'L', text: 'x' })], [wire('e', 'then', 'a', 'in')])
  const src = (flow?: string) => generateGraphClasses({ modId: 'M', swfCls: 'T', graphs: [g], packs, layerPath: (id) => (id === 'L' ? 'title' : undefined), ...(flow ? { flow } : {}) }).classes[0]!.source
  it('Set Text lays out the frames above its layer again, only when the SWF has such frames', () => {
    expect(src('mods.M.InkwellFlow')).toMatch(/__g\.base\.title\.text = "x";\s+mods\.M\.InkwellFlow\.touch\(__g\.base\.title\);/)
    expect(src()).not.toContain('touch(')
  })
})

describe('Get Time and On Update (V13.4: time from getTimer, no per-frame event)', () => {
  it('Get Time is volatile: two consumers read the clock twice, never a cached temp', () => {
    const g = graph('t', [entry, node('t', 'core/GetTime@1'), setText('a'), setText('b')], [wire('e', 'then', 'a', 'in'), wire('a', 'then', 'b', 'in'), wire('t', 'value', 'a', 'text'), wire('t', 'value', 'b', 'text')])
    const out = body(gen(g).classes[0]!.source)
    expect(out).not.toContain('var t_')
    expect(count(out, 'getTimer() / 1000')).toBe(2)
  })
  it('On Update ticks from setInterval with the measured delta and registers for Stop Timer; no onEnterFrame', () => {
    const g = graph('u', [node('u', 'core/OnUpdate@1', { seconds: 0.25, name: 'clock' }), setText('a'), node('st', 'core/StopTimer@1', { name: 'clock' })], [wire('u', 'then', 'a', 'in'), wire('u', 'delta', 'a', 'text'), wire('a', 'then', 'st', 'in')])
    const r = gen(g)
    expect(r.issues).toEqual([])
    const out = body(r.classes[0]!.source)
    expect(out).toMatchSnapshot()
    expect(out).toContain('var u_delta = (now - __g.s_u) / 1000;')
    expect(out).toContain('}, 0.25 * 1000);')
    expect(out).toContain('__g.tm["clock" == "" ? "u" : "clock"] = __g.t_u;')
    expect(out).toContain('clearInterval(__g.tm["clock"]);')
    expect(out).not.toContain('onEnterFrame')
  })
})

describe('Raw AS2', () => {
  it('writes its code verbatim, one source-map line per code line, inside the guarded handler', () => {
    const g = graph('raw', [entry, node('x', 'core/RawAS2@1', { code: 'var a = 1;\nif (a) {\n    trace("{{x}}");\n}' })], [wire('e', 'then', 'x', 'in')])
    const r = gen(g)
    expect(r.issues).toEqual([])
    const lines = r.classes[0]!.source.split('\n')
    const i = lines.findIndex((l) => l.trim() === 'var a = 1;')
    expect(lines.slice(i, i + 4).map((l) => l.trim())).toEqual(['var a = 1;', 'if (a) {', 'trace("{{x}}");', '}'])
    expect(lines[i + 1]!.startsWith(lines[i]!.match(/^\s*/)![0])).toBe(true)
    for (let k = 0; k < 4; k++) expect(r.classes[0]!.map.lines[String(i + 1 + k)]).toBe('x')
  })
})
