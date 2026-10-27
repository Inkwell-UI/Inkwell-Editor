import type { MergedContract, MergedEntry } from '@inkwell-ui/spec'

// The engine glue of a menu replacement (SPEC-CHANGES W5), generated from the merged contract and modelled on the hand-written spike S-B SWF
// (scripts/spike-05b.ts, which worked in game with and without SkyUI): the class `mods.<modId>.<Swf>Contract`, installed at `_root.inkwellContract`
// before any graph starts. It defines the contract's root functions, the object a function with members returns (the Inventory item list), the
// ExternalInterface `call`/`respond` bridge of gfx.io.GameDelegate and the `_global` values the picked layers ask for (SkyUI 5.2's version statics).
// Contract nodes (core pack, `extra.contract`) use only `on`, `send`, `select` and `list` (Core-Pack docs/templates.md, Contract nodes). Pure text.

export interface ReplacementGlue {
  /** The class source (`__Packages/mods/<mod>/<cls>.as`). */
  source: string
  /** What the glue defines, as contract paths -> AS2 type (`checkContract`'s `provided`). */
  provided: Record<string, string>
}

export const replacementClassName = (swfCls: string): string => `${swfCls}Contract`

/** The frame code that installs the glue; must run before the graphs are created (they register their handlers in `init()`). */
export const replacementFrameCode = (mod: string, swfCls: string): string[] => [
  `_root.inkwellContract = new mods.${mod}.${replacementClassName(swfCls)}(this);`,
  '_root.inkwellContract.install();'
]

const ROOT_FN = /^_root\.([A-Za-z_$][\w$]*)$/
const MEMBER = /^_root\.([A-Za-z_$][\w$]*)\(\)\.([A-Za-z_$][\w$]*)$/
const GLOBAL = /^_global\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/
const BRIDGE = new Set(['call', 'respond']) // gfx.io.GameDelegate's ExternalInterface callbacks, not plain root functions

const initial: Record<string, string> = { Array: '[]', Number: '0', String: '""', Boolean: 'false', Object: '{}', Function: 'function() {}' }
const lit = (v: string | number | boolean): string => (typeof v === 'string' ? JSON.stringify(v) : String(v))
/** `unused` entries are names the engine looks up although nothing depends on them; the glue leaves them out, as the spike did. */
const wanted = (e: MergedEntry): boolean => e.required !== 'unused'

/**
 * The glue for one merged contract. `preview` (Ruffle): no ExternalInterface `call`/`respond` registration (the editor talks to Ruffle through
 * ExternalInterface too) and engine calls are traced instead of sent; nothing else differs.
 */
export function replacementGlue(c: MergedContract, mod: string, swfCls: string, preview = false): ReplacementGlue {
  const cls = replacementClassName(swfCls)
  const provided: Record<string, string> = {}
  const members = new Map<string, { name: string; type: string }[]>() // root function -> members of the object it returns
  for (const e of c.entries) {
    const m = e.kind === 'member' && e.path && wanted(e) ? MEMBER.exec(e.path) : null
    if (m && e.type && initial[e.type]) members.set(m[1]!, [...(members.get(m[1]!) ?? []), { name: m[2]!, type: e.type }])
  }
  const fns = c.entries.flatMap((e) => { const f = e.kind === 'function' && e.path && wanted(e) ? ROOT_FN.exec(e.path)?.[1] : undefined; return f ? [f] : [] })
  const listFn = fns.find((f) => members.has(f))
  const globals = new Map<string, [string, string][]>() // _global class -> [static, literal]
  for (const e of c.entries) {
    const g = e.kind === 'global' && e.path && e.value !== undefined && wanted(e) ? GLOBAL.exec(e.path) : null
    if (!g) continue
    globals.set(g[1]!, [...(globals.get(g[1]!) ?? []), [g[2]!, lit(e.value!)]])
    provided[e.path!] = e.type ?? 'Object'
  }

  const install: string[] = ['        var self = this;']
  if (listFn) {
    const ms = members.get(listFn)!
    for (const x of ms) provided[`_root.${listFn}().${x.name}`] = x.type
    const has = (n: string): boolean => ms.some((x) => x.name === n)
    install.push(
      `        // the object _root.${listFn}() returns: the engine fills its members and reads them (S-B: entryList filled, selectedIndex read for the item it acts on)`,
      '        this.list = this.base.createEmptyMovieClip("inkwellList", this.base.getNextHighestDepth());',
      ...ms.map((x) => `        this.list.${x.name} = ${initial[x.type]};`),
      ...(has('entryList') && has('selectedIndex')
        ? [
            '        // the other list members of the spike baseline; the engine never used them in S-B',
            '        this.list.scrollPosition = 0;',
            '        this.list.addProperty("selectedEntry", function() { return this.entryList[this.selectedIndex]; }, null);',
            '        this.list.addProperty("length", function() { return this.entryList.length; }, null);',
            '        this.list.InvalidateData = function() {};',
            '        this.list.UpdateList = function() {};'
          ]
        : [])
    )
  } else install.push('        this.list = {};')
  for (const f of fns) {
    if (BRIDGE.has(f)) continue
    provided[`_root.${f}`] = 'Function'
    install.push(f === listFn ? `        this.base.${f} = function() { return self.list; };` : `        this.base.${f} = function() { self.fire(${lit(f)}, self.args(arguments, 0)); };`)
  }
  const bridged = fns.filter((f) => BRIDGE.has(f))
  if (bridged.length) {
    install.push(
      preview ? '        // Ruffle preview: the engine bridge is not registered (no engine; the editor drives Ruffle through the same interface)' : '        // engine -> AS through ExternalInterface, as gfx.io.GameDelegate registers it (S-B A5: without it no callback arrives)',
      ...bridged.flatMap((f) => {
        provided[`_root.${f}`] = 'Function'
        const body = f === 'call' ? 'function(name) { self.fire(String(name), self.args(arguments, 1)); }' : 'function(uid) { self.answer(uid, self.args(arguments, 1)); }'
        return preview ? [] : [`        flash.external.ExternalInterface.addCallback(${lit(f)}, this.base, ${body});`]
      })
    )
  }
  for (const [g, statics] of globals) install.push(`        _global.${g} = function() {};`, ...statics.map(([k, v]) => `        _global.${g}.${k} = ${v};`))

  const lines = [
    `// Generated by Inkwell: the engine glue of a menu replacement (contract "${c.menu}", layers ${c.layers.join(', ')}; SPEC-CHANGES W5). Do not edit.`,
    `class mods.${mod}.${cls} {`,
    '    var base;',
    '    var list;',
    '    var handlers;',
    '    var pending;',
    '    var nextId;',
    `    function ${cls}(base) {`,
    '        this.base = base;',
    '        this.handlers = {};',
    '        this.pending = {};',
    '        this.nextId = 0;',
    '    }',
    '    function install() {',
    ...install,
    '    }',
    '    function args(a, from) {',
    '        var r = [];',
    '        for (var k = from; k < a.length; k++) r.push(a[k]);',
    '        return r;',
    '    }',
    '    // contract nodes: an engine callback (or a respond answer) runs every handler registered under its name',
    '    function on(name, fn) {',
    '        if (this.handlers[name] == undefined) this.handlers[name] = [];',
    '        this.handlers[name].push(fn);',
    '    }',
    '    function fire(name, a) {',
    '        var list = this.handlers[name];',
    '        if (list == undefined) return;',
    '        for (var k = 0; k < list.length; k++) {',
    '            try {',
    '                list[k].apply(null, a);',
    '            } catch (e) {',
    '                trace("[Inkwell] error " + name + ": " + e);',
    '            }',
    '        }',
    '    }',
    '    // AS -> engine in the GameDelegate wire format: call(name, uid, ...args); the engine answers a request through respond(uid, ...) during the call',
    '    function send(name, a, respondTo) {',
    '        var id = this.nextId++;',
    '        if (respondTo != undefined) this.pending[id] = respondTo;',
    '        var p = [name, id];',
    '        for (var k = 0; k < a.length; k++) p.push(a[k]);',
    ...(preview ? ['        trace("[Inkwell] info : engine call " + p.join(", "));'] : ['        flash.external.ExternalInterface.call.apply(null, p);']),
    '        delete this.pending[id];',
    '    }',
    '    function answer(uid, a) {',
    '        var to = this.pending[uid];',
    '        delete this.pending[uid];',
    '        if (to != undefined) this.fire(to, a);',
    '    }',
    '    // the engine acts on the list\'s selectedIndex (S-B A6); -1 keeps the current one',
    '    function select(index) {',
    '        if (index >= 0) this.list.selectedIndex = index;',
    '    }',
    '}',
    ''
  ]
  return { source: lines.join('\n'), provided }
}
