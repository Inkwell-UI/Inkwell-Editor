import { pinCompat, type Graph, type GraphNode, type NodeDef, type PinType } from '@inkwell-ui/spec'
import { resolvePins, type ResolvedPin } from '../../shared/graphValidate'
import { parseBindings, type BindProp } from '../../shared/graphBinding'
import { ident } from '../../shared/overlay'
import type { CodegenPacks } from './packs'

/** Template format: Inkwell-Core-Pack `docs/templates.md`. The renderer and its decisions: `docs/codegen.md`. */

export interface CodegenIssue {
  graphId: string
  nodeId?: string
  code: 'graph-codegen'
  message: string
}

export interface WidgetCall {
  /** AS2 handler name = Papyrus function name. */
  name: string
  params: { name: string; type: 'String' | 'Number' | 'Bool' }[]
}

/** Generated line (1-based, as a string key) -> graph node id. Lines of the class scaffolding have no entry. */
export interface SourceMap {
  version: 1
  graph: string
  file: string
  lines: Record<string, string>
}

export interface GraphClass {
  graphId: string
  /** Simple class name; the full name is `mods.<modId>.<cls>`. */
  cls: string
  /** Path relative to the scripts folder. */
  path: string
  source: string
  map: SourceMap
  calls: WidgetCall[]
}

export interface CodegenInput {
  modId: string
  /** Prefix of the class names (the SWF's class name, e.g. `Hud`); classes are `<prefix>Graph_<graphId>`. */
  swfCls: string
  graphs: readonly Graph[]
  packs: CodegenPacks
  /** Clip path of a Figma layer relative to the base clip, `''` for the base clip itself, undefined when the layer is not compiled. */
  layerPath: (figmaId: string) => string | undefined
  /** Overlay `dataBinding` strings by Figma layer id (grammar: `shared/graphBinding.ts`). `var:` bindings are applied on init and after every Set Variable. */
  bindings?: Readonly<Record<string, string>>
  /**
   * Ruffle preview build (debugging, docs/debugging.md): pure node outputs and On Widget Call parameters are traced as `[Inkwell] pin <node>.<pin> = <value>`,
   * `mock:` bindings and variables named like a mock key follow the mock data Ruffle Play mode delivers. Never set for the game SWF.
   */
  preview?: boolean
  /**
   * Custom menu served by the Inkwell Runtime (S7, docs/menus.md): the graph class also gets the `bridge` member the menu class sets, `log` (Log nodes and `fail` go to
   * `bridge.log`, so the runtime's log and trace see the node id), and the message/mod-event registries `handleMessage` / `handleModEvent` the runtime-event nodes use.
   * Without it the output is exactly what a HUD widget gets.
   */
  menu?: boolean
}

interface Line {
  t: string
  n?: string
}
const ind = (lines: Line[], s: string): Line[] => lines.map((l) => ({ ...l, t: s + l.t }))
const PH = /\{\{(\w+)(?:\.(\w+))?\}\}/g
const COMPONENT = new Set<PinType>(['Text', 'Button', 'List', 'Image', 'Clip'])
const AS2_TYPE = { String: 'String', Number: 'Number', Bool: 'Boolean' } as const
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

class Skip {
  constructor(readonly message: string) {}
}

/** AS2 literal of a JSON value; strings are escaped (JSON string syntax is AS2 string syntax). */
export function as2Literal(v: unknown): string {
  if (v === undefined || v === null) return 'undefined'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return JSON.stringify(v)
}

const defaultOf = (t: PinType): unknown => (t === 'Bool' ? false : t === 'Number' ? 0 : t === 'String' ? '' : t === 'Array' ? [] : t === 'Object' ? {} : undefined)

/** Index just after the group that opens at `i` (`(`), skipping string literals; -1 when unbalanced. */
function closeOf(s: string, i: number): number {
  let depth = 0
  for (let k = i; k < s.length; k++) {
    const c = s[k]!
    if (c === '"' || c === "'") {
      for (k++; k < s.length && s[k] !== c; k++) if (s[k] === '\\') k++
    } else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return k + 1
  }
  return -1
}

/** Safe to embed as an operand without parentheses: a name path, a literal, a fully parenthesised group, or a call. */
export function isAtomic(s: string): boolean {
  if (s === '[]' || s === '{}') return true
  if (/^-?\d+(\.\d+)?$/.test(s) || /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(s)) return true
  if (/^"([^"\\]|\\.)*"$/.test(s)) return true
  const call = /^([A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*)?\(/.exec(s)
  return !!call && closeOf(s, call[0].length - 1) === s.length
}
/** Costs nothing to evaluate twice and cannot change between two reads: a name path or a literal. Anything else is hoisted when read more than once. */
export const isTrivial = (s: string): boolean => s === '[]' || s === '{}' || /^(-?\d+(\.\d+)?|[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*|"([^"\\]|\\.)*")$/.test(s)
const wrap = (s: string): string => (isAtomic(s) ? s : `(${s})`)

/** Block scope for pure-node temps. Flash 8 has no block scope; a block here is a statement chain that may be skipped (branch) or run elsewhere (closure). */
class Cache {
  readonly temps = new Map<string, string>()
  constructor(readonly parent?: Cache) {}
  get(id: string): string | undefined {
    return this.temps.get(id) ?? this.parent?.get(id)
  }
}

interface Ctx {
  cache: Cache
  /** Statements (temps) that must run before the statement being built. */
  pre: Line[]
  /** The entry node whose handler we are in: `guarded` reports failures under this id. */
  entry: string
  /** Exec nodes on the way here, to stop cycles. */
  stack: ReadonlySet<string>
}

interface Val {
  expr: string
  /** Reads mutable state, directly or through its inputs: never cached. */
  volatile: boolean
}

/**
 * Menu flavour of the Log node: `trace("[Inkwell] <level> <id>: " + msg);` becomes `__g.log("<level>", "<id>", msg);` so the line reaches the runtime's log with the node id.
 * Done on the filled template line so the Core-Pack template stays as it is (Ruffle's mock bridge prints the same trace line the panel parses).
 */
export function toBridgeLog(line: string): string {
  const m = /^(\s*)trace\("\[Inkwell\] (\w+) ((?:[^"\\]|\\.)*): " \+ (.*)\);$/.exec(line)
  return m ? `${m[1]}__g.log("${m[2]}", "${m[3]}", ${m[4]});` : line
}

const key = (node: string, pin: string): string => `${node}\u0000${pin}`

/** Generates one AS2 class for one graph. */
function generateOne(g: Graph, cls: string, i: CodegenInput, issues: CodegenIssue[], first: boolean): GraphClass {
  const file = `__Packages/mods/${ident(i.modId)}/${cls}.as`
  const issue = (message: string, nodeId?: string): void => void issues.push({ graphId: g.id, ...(nodeId ? { nodeId } : {}), code: 'graph-codegen', message })
  const nodes = new Map(g.nodes.map((n) => [n.id, n]))
  const defOf = (n: GraphNode): NodeDef | undefined => i.packs.defs.get(n.kind)
  const pinsOf = new Map<string, ReturnType<typeof resolvePins>>()
  for (const n of g.nodes) {
    const d = defOf(n)
    if (d) pinsOf.set(n.id, resolvePins(d, n, g.variables))
  }
  // unique identifier-safe node ids and variable names
  const uids = new Map<string, string>()
  const taken = new Set<string>()
  const uniq = (base: string, set: Set<string>): string => {
    let s = base
    for (let k = 2; set.has(s); k++) s = `${base}_${k}`
    set.add(s)
    return s
  }
  for (const n of g.nodes) uids.set(n.id, uniq(ident(n.id), taken))
  const varNames = new Map<string, string>()
  const vtaken = new Set<string>()
  for (const v of g.variables) varNames.set(v.id, uniq(ident(v.name), vtaken))
  const names = new Set<string>() // generated locals; node uids are prefixes, so keep the namespaces apart with `t_`
  const temp = (base: string): string => uniq(`t_${base}`, names)

  const dataIn = new Map<string, { node: string; pin: string }>() // node\0input pin -> source output
  const execTo = new Map<string, string[]>() // node\0exec output pin -> target nodes
  const consumers = new Map<string, number>()
  for (const e of g.edges) {
    const a = nodes.get(e.from.node)
    const b = nodes.get(e.to.node)
    if (!a || !b) continue
    const pa = pinsOf.get(a.id)?.outputs.find((p) => p.name === e.from.pin)
    if (!pa) continue
    if (pa.type === 'Exec') execTo.set(key(a.id, e.from.pin), [...(execTo.get(key(a.id, e.from.pin)) ?? []), b.id])
    else {
      dataIn.set(key(b.id, e.to.pin), { node: a.id, pin: e.from.pin })
      consumers.set(key(a.id, e.from.pin), (consumers.get(key(a.id, e.from.pin)) ?? 0) + 1)
    }
  }

  // ---- data bindings (overlay `dataBinding`) ----
  const clipOf = (layer: string): string | undefined => {
    const p = i.layerPath(layer)
    return p === undefined ? undefined : p === '' ? '__g.base' : `__g.base.${p}`
  }
  const apply = (prop: BindProp, clip: string, x: string): string =>
    prop === 'text' ? `${clip}.text = String(${x});` : prop === 'visible' ? `${clip}._visible = (${x} == true || ${x} == "true");` : prop === 'alpha' ? `${clip}._alpha = Number(${x});` : `new Color(${clip}).setRGB(Number(${x}));`
  const binders = new Map<string, string[]>() // variable id -> statements that copy it to its bound properties
  const mockBound: string[] = []
  for (const [layer, str] of Object.entries(i.bindings ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const clip = clipOf(layer)
    if (clip === undefined) continue
    for (const b of parseBindings(str).bindings) {
      if (b.source === 'var') {
        const v = g.variables.find((x) => x.id === b.name)
        if (v) binders.set(v.id, [...(binders.get(v.id) ?? []), apply(b.prop, clip, `__g.v_${varNames.get(v.id)}`)])
      } else if (i.preview && first) mockBound.push(`if (m[${as2Literal(b.name)}] != undefined) { ${apply(b.prop, clip, `m[${as2Literal(b.name)}]`)} }`)
    }
  }

  const bodyOf = (n: GraphNode, d: NodeDef): string[] => {
    const t = i.packs.templates.get(`${n.kind}`)
    if (t === undefined) throw new Skip(`${d.title} has no AS2 template.`)
    return t.replace(/\n+$/, '').split('\n')
  }
  const fieldOf = (n: GraphNode, d: NodeDef, name: string): unknown => {
    if (!(name in d.fields)) throw new Skip(`template uses the unknown field "${name}".`)
    return n.fields[name] ?? (d.fields[name] as { default?: unknown } | undefined)?.default
  }
  const safeId = (s: string): string => s.replace(/[\\"\r\n]/g, '_')

  /** The AS2 expression feeding data input `pin` of node `n`. */
  const input = (n: GraphNode, pin: ResolvedPin, ctx: Ctx, visiting: ReadonlySet<string>): Val => {
    const src = dataIn.get(key(n.id, pin.name))
    if (!src) {
      const v = n.fields[pin.name]
      if (COMPONENT.has(pin.type)) {
        if (typeof v !== 'string' || v === '') throw new Skip(`input "${pin.name}" has no target layer.`)
        const p = i.layerPath(v)
        if (p === undefined) throw new Skip(`the target layer ${v} of "${pin.name}" is not compiled.`)
        return { expr: p === '' ? '__g.base' : `__g.base.${p}`, volatile: false }
      }
      const declared = defOf(n)?.inputs.find((x) => x.name === pin.name)
      // the pack's default belongs to the declared type; a pin retyped by typeFrom (variables, Compare) gets the zero of its effective type
      const def = declared?.type === pin.type ? (declared as { default?: unknown }).default : undefined
      return { expr: as2Literal(v ?? def ?? defaultOf(pin.type)), volatile: false }
    }
    const s = nodes.get(src.node)!
    const sd = defOf(s)
    const sp = pinsOf.get(s.id)?.outputs.find((p) => p.name === src.pin)
    if (!sd || !sp) throw new Skip(`input "${pin.name}" is wired to a node that cannot be compiled.`)
    let v: Val
    if (sd.pure) v = pure(s, sd, ctx, visiting)
    else v = { expr: `${uids.get(s.id)}_${src.pin}`, volatile: false }
    if (pinCompat(sp.type, pin.type) === 'coerce') v = { ...v, expr: `${pin.type === 'Number' ? 'Number' : 'String'}(${v.expr})` }
    return v
  }

  /** Placeholders of a template line, shared by pure and exec nodes. `args` are the inputs (already parenthesised when needed). */
  const fill = (text: string, n: GraphNode, d: NodeDef, args: Map<string, string>, outs: ReadonlySet<string>): string =>
    text.replace(PH, (_, k: string, name: string | undefined) => {
      const nm = name ?? ''
      switch (k) {
        case 'node': return nm === 'id' ? safeId(n.id) : uids.get(n.id)!
        case 'in': return args.get(nm) ?? (() => { throw new Skip(`template uses the unknown input "${nm}".`) })()
        case 'out':
          if (!outs.has(nm)) throw new Skip(`template uses the unknown output "${nm}".`)
          return `${uids.get(n.id)}_${nm}`
        case 'field': return as2Literal(fieldOf(n, d, nm))
        case 'raw': {
          const v = fieldOf(n, d, nm)
          const s = d.fields[nm] as { enum?: unknown[]; pattern?: string }
          const ok = Array.isArray(s.enum) ? s.enum.includes(v) : typeof s.pattern === 'string' && typeof v === 'string' && new RegExp(s.pattern).test(v)
          if (!ok) throw new Skip(`field "${nm}" must be one of the allowed values or match its pattern to be written as code (got ${JSON.stringify(v)}).`)
          return String(v)
        }
        case 'var': {
          const v = fieldOf(n, d, nm)
          const vn = typeof v === 'string' ? varNames.get(v) : undefined
          if (!vn) throw new Skip(`field "${nm}" names a variable that does not exist.`)
          return `__g.v_${vn}`
        }
        case 'params': {
          const dyn = (d.extra as { dynamicOutputs?: string } | undefined)?.dynamicOutputs
          return paramsOf(n, dyn).map((p) => `${uids.get(n.id)}_${p.name}:${AS2_TYPE[p.type]}`).join(', ')
        }
        default: throw new Skip(`unknown placeholder {{${k}${name ? '.' + name : ''}}}.`)
      }
    })

  const paramsOf = (n: GraphNode, dyn: string | undefined): WidgetCall['params'] => {
    const list = dyn ? n.fields[dyn] : []
    if (!Array.isArray(list)) return []
    return list.map((p: { name?: unknown; type?: unknown }) => {
      if (typeof p?.name !== 'string' || !IDENT.test(p.name) || (p.type !== 'String' && p.type !== 'Number' && p.type !== 'Bool')) throw new Skip('a parameter needs an identifier name and the type String, Number or Bool.')
      return { name: p.name, type: p.type }
    })
  }

  /** Arguments of a node: every data input resolved; an input the template repeats is hoisted into a temp when it is not atomic. */
  const argsOf = (n: GraphNode, d: NodeDef, templateText: string, ctx: Ctx, visiting: ReadonlySet<string>): { args: Map<string, string>; volatile: boolean } => {
    const args = new Map<string, string>()
    let volatile = false
    const uses = new Map<string, number>()
    for (const m of templateText.matchAll(PH)) if (m[1] === 'in') uses.set(m[2]!, (uses.get(m[2]!) ?? 0) + 1)
    for (const p of pinsOf.get(n.id)!.inputs.filter((x) => x.type !== 'Exec')) {
      const v = input(n, p, ctx, visiting)
      volatile ||= v.volatile
      let e = wrap(v.expr)
      if ((uses.get(p.name) ?? 0) > 1 && !isTrivial(v.expr)) {
        const t = temp(`${uids.get(n.id)}_${p.name}`)
        ctx.pre.push({ t: `var ${t} = ${v.expr};`, n: n.id })
        e = t
      }
      args.set(p.name, e)
    }
    return { args, volatile }
  }

  /** A pure node: one expression, inlined or, when several consumers read it (and it is not volatile), a temp cached in the current block. */
  const pure = (n: GraphNode, d: NodeDef, ctx: Ctx, visiting: ReadonlySet<string>): Val => {
    const cached = ctx.cache.get(n.id)
    if (cached) return { expr: cached, volatile: false }
    if (visiting.has(n.id)) throw new Skip('the data wires loop back to this node.')
    const lines = bodyOf(n, d)
    const text = lines.slice(1).join(' ').trim()
    const { args, volatile: inVol } = argsOf(n, d, text, ctx, new Set([...visiting, n.id]))
    let expr: string
    try {
      expr = fill(text, n, d, args, new Set())
    } catch (e) {
      if (e instanceof Skip) throw new Skip(`${d.title}: ${e.message}`)
      throw e
    }
    const volatile = inVol || (d.extra as { volatile?: unknown } | undefined)?.volatile === true
    const out = d.outputs[0]?.name ?? 'value'
    if (i.preview) expr = `__g.pv("${safeId(n.id)}", "${safeId(out)}", ${expr})`
    if (!volatile && (consumers.get(key(n.id, out)) ?? 0) > 1 && !isTrivial(expr)) {
      const t = temp(uids.get(n.id)!)
      ctx.pre.push({ t: `var ${t} = ${expr};`, n: n.id })
      ctx.cache.temps.set(n.id, t)
      return { expr: t, volatile: false }
    }
    return { expr: wrap(expr), volatile }
  }

  const chain = (from: GraphNode, pin: string, ctx: Ctx): Line[] =>
    (execTo.get(key(from.id, pin)) ?? []).flatMap((id) => emit(nodes.get(id)!, { ...ctx, cache: new Cache(ctx.cache) }))

  /** An exec node (or entry) as statements. A node that cannot be compiled becomes a comment and an issue; the rest of the graph still compiles. */
  const emit = (n: GraphNode, parent: Ctx): Line[] => {
    const d = defOf(n)
    if (!d) {
      issue(`Unknown node kind ${n.kind}; skipped.`, n.id)
      return [{ t: `// [${safeId(n.id)}] skipped: unknown node ${safeId(n.kind)}`, n: n.id }]
    }
    if (d.pure || (d.extra as { editorOnly?: unknown } | undefined)?.editorOnly === true) return []
    if (parent.stack.has(n.id)) {
      issue('The exec flow loops back to this node; skipped.', n.id)
      return []
    }
    const isEntry = (d.extra as { entry?: unknown } | undefined)?.entry === true
    const ctx: Ctx = { ...parent, pre: [], entry: isEntry ? n.id : parent.entry, stack: new Set([...parent.stack, n.id]) }
    try {
      const lines = bodyOf(n, d)
      const { args } = argsOf(n, d, lines.join('\n'), ctx, new Set())
      const outs = new Set((pinsOf.get(n.id)?.outputs ?? []).filter((p) => p.type !== 'Exec').map((p) => p.name))
      const out: Line[] = [...ctx.pre]
      for (const raw of lines) {
        const own = /^(\s*)\{\{(next|guarded)\.(\w+)\}\}\s*$/.exec(raw)
        if (own) {
          if (!(pinsOf.get(n.id)?.outputs ?? []).some((p) => p.name === own[3] && p.type === 'Exec')) throw new Skip(`template uses the unknown exec output "${own[3]}".`)
          const sub = chain(n, own[3]!, ctx)
          if (own[2] === 'guarded' && isEntry && i.preview && lines.some((l) => l.includes('{{params}}')))
            for (const p of [...outs].reverse()) sub.unshift({ t: `__g.pv("${safeId(n.id)}", "${safeId(p)}", ${uids.get(n.id)}_${p});`, n: n.id })
          const boundVar = /^core\/(SetVariable|Toggle)@/.test(n.kind) ? String(n.fields['variable']) : undefined
          if (boundVar && binders.has(boundVar)) out.push({ t: `${own[1]}__g.b_${varNames.get(boundVar)}();`, n: n.id })
          if (own[2] === 'next') out.push(...ind(sub, own[1]!))
          else
            out.push(
              { t: `${own[1]}try {`, n: n.id },
              ...ind(sub, own[1] + '    '),
              { t: `${own[1]}} catch (e) {`, n: n.id },
              { t: `${own[1]}    __g.fail("${safeId(ctx.entry)}", e);`, n: n.id },
              { t: `${own[1]}}`, n: n.id }
            )
        } else {
          if (/\{\{(next|guarded)\./.test(raw)) throw new Skip('a continuation placeholder must be alone on its line.')
          out.push({ t: i.menu ? toBridgeLog(fill(raw, n, d, args, outs)) : fill(raw, n, d, args, outs), n: n.id })
        }
      }
      return out
    } catch (e) {
      if (!(e instanceof Skip)) throw e
      issue(`${d.title}: ${e.message}`, n.id)
      return [{ t: `// [${safeId(n.id)}] skipped: ${e.message.replace(/[\r\n]+/g, ' ')}`, n: n.id }]
    }
  }

  // ---- the class ----
  const init: Line[] = [{ t: 'var __g = this;' }]
  for (const v of g.variables) init.push({ t: `__g.v_${varNames.get(v.id)} = ${as2Literal(v.default ?? defaultOf(v.type))};` })
  for (const [vid, stmts] of binders) {
    const vn = varNames.get(vid)!
    init.push({ t: `__g.b_${vn} = function() {` }, { t: '    try {' }, ...stmts.map((t) => ({ t: `        ${t}` })), { t: '    } catch (e) {' }, { t: `        __g.fail("binding:${vn}", e);` }, { t: '    }' }, { t: '};' }, { t: `__g.b_${vn}();` })
  }
  if (i.preview) {
    // Ruffle Play mode: `_global.Inkwell.mock` is filled by the editor (inkwellMock callback); a variable named like a key takes its value, then bindings follow
    const fromMock = g.variables.flatMap((v) => {
      const x = `m[${as2Literal(v.name)}]`
      const val = v.type === 'Number' ? `Number(${x})` : v.type === 'String' ? `String(${x})` : v.type === 'Bool' ? `(${x} == true || ${x} == "true")` : undefined
      return val ? [`if (${x} != undefined) { __g.v_${varNames.get(v.id)} = ${val};${binders.has(v.id) ? ` __g.b_${varNames.get(v.id)}();` : ''} }`] : []
    })
    if (fromMock.length || mockBound.length)
      init.push(
        { t: '__g.mock = function() {' }, { t: '    var m = _global.Inkwell.mock;' },
        ...[...fromMock, ...mockBound].map((t) => ({ t: `    try { ${t} } catch (e) { __g.fail("mock", e); }` })),
        { t: '};' }, { t: 'if (_global.Inkwell.mockListeners != undefined) _global.Inkwell.mockListeners.push(__g.mock);' }, { t: '__g.mock();' }
      )
  }
  const calls: WidgetCall[] = []
  const root: Ctx = { cache: new Cache(), pre: [], entry: '', stack: new Set() }
  for (const n of g.nodes) {
    const d = defOf(n)
    if (!d || (d.extra as { entry?: unknown } | undefined)?.entry !== true) continue
    const lines = emit(n, { ...root, cache: new Cache() })
    init.push(...lines)
    if (n.kind.split('/')[1]?.startsWith('OnWidgetCall@') && lines.length > 1) {
      try {
        const name = String(n.fields['name'] ?? (d.fields['name'] as { default?: string }).default)
        const params = paramsOf(n, 'params')
        calls.push({ name, params })
        // Papyrus passes the arguments as one string array (no mixed-type Invoke exists); the clip method converts them to the typed parameters
        const conv = params.map((p, k) => (p.type === 'String' ? `a[${k}] == undefined ? "" : String(a[${k}])` : p.type === 'Number' ? `Number(a[${k}]) || 0` : `a[${k}] == true || a[${k}] == "true"`))
        init.push({ t: `__g.base.${name} = function(a) {`, n: n.id }, { t: '    if (!(a instanceof Array)) a = arguments; // Skyrim spreads UI.InvokeStringA into separate arguments; Ruffle passes one array', n: n.id }, { t: `    __g.${name}(${conv.map((c) => `(${c})`).join(', ')});`, n: n.id }, { t: '};', n: n.id })
      } catch (e) {
        if (!(e instanceof Skip)) throw e
      }
    }
  }

  // On Load: the graph is created after every clip is placed, so that is when it fires (a widget starts hidden this way)
  const onLoad = g.nodes.find((n) => n.kind.split('/')[1]?.startsWith('OnLoad@') && init.some((l) => l.n === n.id))
  if (onLoad) init.push({ t: 'if (__g.onLoad != undefined) __g.onLoad();', n: onLoad.id })

  const head: Line[] = [
    { t: `// Generated by Inkwell from the graph "${g.name.replace(/[\r\n]+/g, ' ').replace(/\*\//g, '* /')}" (${g.id.replace(/[\r\n]+/g, ' ')}). Do not edit.` },
    { t: '// AS2 sealing is a compile-time check only and the FFDec AS2 compiler does not parse the keyword `dynamic`; members are added freely (s_, t_, h_, v_).' },
    { t: `class mods.${ident(i.modId)}.${cls} {` },
    { t: '    var base;' },
    { t: '    var inputHandlers;' },
    ...(i.menu ? [{ t: '    var bridge;' }, { t: '    var messageHandlers;' }, { t: '    var modEventHandlers;' }] : []),
    { t: `    function ${cls}(base) {` },
    { t: '        this.base = base;' },
    { t: '        this.inputHandlers = {};' },
    ...(i.menu ? [{ t: '        this.messageHandlers = [];' }, { t: '        this.modEventHandlers = [];' }] : []),
    { t: '    }' },
    { t: '    // logs the failing node id; e is a string or a plain object {node, message} (GFx has no Error class)' },
    { t: '    function fail(nodeId, e) {' },
    { t: '        var msg = "";' },
    { t: '        if (typeof (e) == "object") {' },
    { t: '            if (e.node != undefined) nodeId = e.node;' },
    { t: '            msg = e.message != undefined ? String(e.message) : String(e);' },
    { t: '        } else {' },
    { t: '            msg = String(e);' },
    { t: '        }' },
    ...(i.menu
      ? [
          { t: '        this.log("error", nodeId, msg);' },
          { t: '    }' },
          // S4.2: the runtime's bridge writes the line (spdlog, dev stream) with the node id; the stub bridge of a missing runtime is not ready, so the trace is the fallback
          { t: '    function log(level, nodeId, text) {' },
          { t: '        if (this.bridge.ready == true) {' },
          { t: '            this.bridge.log(level, nodeId, String(text));' },
          { t: '        } else {' },
          { t: '            trace("[Inkwell] " + level + " " + nodeId + ": " + text);' },
          { t: '        }' },
          { t: '    }' }
        ]
      : [
          { t: '        var line = "[Inkwell] error " + nodeId + ": " + msg;' },
          { t: '        trace(line);' },
          { t: '        try {' },
          { t: '            if (typeof (_global.skse) == "object" && _global.skse.Log != undefined) _global.skse.Log(line);' },
          { t: '        } catch (x) {' },
          { t: '        }' },
          { t: '    }' }
        ]),
    ...(i.preview
      ? [
          { t: '    // preview only: live pin values for the editor (traced as "[Inkwell] pin <node>.<pin> = <value>"); passes the value through' },
          { t: '    function pv(nodeId, pin, v) {' },
          { t: '        var s = typeof (v) == "string" ? "\\"" + v.split("\\n").join("\\\\n") + "\\"" : String(v);' },
          { t: '        trace("[Inkwell] pin " + nodeId + "." + pin + " = " + s);' },
          { t: '        return v;' },
          { t: '    }' }
        ]
      : []),
    { t: i.menu ? '    // glue: the menu class (docs/menus.md) calls handleInput / handleMessage / handleModEvent; the runtime forwards the engine events to it' : '    // On Input glue: the host calls handleInput("<action>"); 0.2 has no input source yet (the runtime comes in 0.3)' },
    { t: '    function addInputHandler(action, fn) {' },
    { t: '        if (this.inputHandlers[action] == undefined) this.inputHandlers[action] = [];' },
    { t: '        this.inputHandlers[action].push(fn);' },
    { t: '    }' },
    { t: '    function handleInput(action) {' },
    { t: '        var list = this.inputHandlers[action];' },
    { t: '        for (var k = 0; k < list.length; k++) list[k]();' },
    { t: '    }' },
    ...(i.menu
      ? [
          { t: '    // On Runtime Message (S7): name = Inkwell_API.Set* key; a handler registered under "" takes any name' },
          { t: '    function addMessageHandler(name, fn) {' },
          { t: '        this.messageHandlers.push({ name: name, fn: fn });' },
          { t: '    }' },
          { t: '    function handleMessage(name, text, number, flag) {' },
          { t: '        for (var k = 0; k < this.messageHandlers.length; k++) {' },
          { t: '            var h = this.messageHandlers[k];' },
          { t: '            if (h.name == "" || h.name == name) h.fn(name, text, number, flag);' },
          { t: '        }' },
          { t: '    }' },
          { t: '    // On Mod Event (S7): fires only while the menu is open (the runtime drops events while it is closed)' },
          { t: '    function addModEventHandler(name, fn) {' },
          { t: '        this.modEventHandlers.push({ name: name, fn: fn });' },
          { t: '    }' },
          { t: '    function handleModEvent(name, strArg, numArg) {' },
          { t: '        for (var k = 0; k < this.modEventHandlers.length; k++) {' },
          { t: '            var h = this.modEventHandlers[k];' },
          { t: '            if (h.name == name) h.fn(strArg, numArg);' },
          { t: '        }' },
          { t: '    }' }
        ]
      : []),
    { t: '    function init() {' }
  ]
  const all = [...head, ...ind(init, '        '), { t: '    }' }, { t: '}' }]
  const lines: Record<string, string> = {}
  all.forEach((l, k) => {
    if (l.n) lines[String(k + 1)] = l.n
  })
  return {
    graphId: g.id, cls, path: file, calls,
    source: all.map((l) => l.t).join('\n') + '\n',
    map: { version: 1, graph: g.id, file, lines }
  }
}

/** Compiles every graph to a class. Pure: the result holds sources, source maps and the Widget Call signatures; `issues` are nodes that were skipped. */
export function generateGraphClasses(i: CodegenInput): { classes: GraphClass[]; issues: CodegenIssue[] } {
  const issues: CodegenIssue[] = []
  const used = new Set<string>()
  const classes = i.graphs.map((g, k) => {
    let cls = `${i.swfCls}Graph_${ident(g.id)}`
    for (let k = 2; used.has(cls); k++) cls = `${i.swfCls}Graph_${ident(g.id)}_${k}`
    used.add(cls)
    return generateOne(g, cls, i, issues, k === 0)
  })
  return { classes, issues }
}
