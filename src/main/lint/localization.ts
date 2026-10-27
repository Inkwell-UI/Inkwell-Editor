import { LOC_KEY, type Graph, type Localization, type Swf } from '@inkwell-ui/spec'
import type { DeployLintItem } from '../../shared/deploy'

// Localization lint (SPEC-CHANGES V2, V3, V10, V13). Pure: the deploy gate and the Localization tab call it with the project's SWFs and `localization.json`.
// Codes: errors loc-key-invalid, loc-key-duplicate; warnings loc-translation-missing, loc-key-orphan, loc-source-changed, loc-needs-runtime.

export interface LocSwf {
  name: string
  kind: 'hudWidget' | 'customMenu' | 'menuReplacement'
  orphaned?: boolean
  ir: Swf
  /** Overlay entries by node id (`locKey` is read). */
  overlay?: Record<string, Record<string, unknown>>
  /** The SWF's graphs: a Set Text whose unwired `text` is a `$KEY` is a keyed text too (V13.2, translated at run time). */
  graphs?: readonly Graph[]
}

/** Set Text: in a menu its `text` goes through `__g.tr` (codegen); a `$KEY` literal there is a graph key. */
export const SET_TEXT = /^core\/SetText@/

/** A keyed text layer: the overlay `locKey` of a node that is a text node of the IR. */
export interface KeyedText {
  swf: string
  nodeId: string
  layer: string
  key: string
  /** The source-language text Figma holds; empty for a graph key (its source text lives only in the table). */
  text: string
  kind: LocSwf['kind']
  /** Set when the key comes from a Set Text of this graph (id); `nodeId` is then the graph node and `layer` reads "<graph> > Set Text". */
  graph?: string
}

export function keyedTexts(swfs: readonly LocSwf[]): KeyedText[] {
  const out: KeyedText[] = []
  for (const s of swfs) {
    if (s.orphaned) continue
    for (const [id, o] of Object.entries(s.overlay ?? {})) {
      const key = o['locKey']
      const n = s.ir.nodes[id]
      if (typeof key !== 'string' || !key || n?.type !== 'text') continue
      out.push({ swf: s.name, nodeId: id, layer: n.name, key, text: n.content, kind: s.kind })
    }
    for (const g of s.graphs ?? []) {
      const wired = new Set(g.edges.filter((e) => e.to.pin === 'text').map((e) => e.to.node))
      for (const n of g.nodes) {
        const key = n.fields['text']
        if (SET_TEXT.test(n.kind) && typeof key === 'string' && LOC_KEY.test(key) && !wired.has(n.id)) out.push({ swf: s.name, nodeId: n.id, layer: `${g.name} > Set Text`, key, text: '', kind: s.kind, graph: g.id })
      }
    }
  }
  return out
}

const list = (keys: readonly string[], max = 4): string => keys.slice(0, max).join(', ') + (keys.length > max ? `, and ${keys.length - max} more` : '')

export function localizationLint(swfs: readonly LocSwf[], loc: Localization | undefined): DeployLintItem[] {
  const out: DeployLintItem[] = []
  const texts = keyedTexts(swfs)
  if (!texts.length && !loc) return out

  const item = (severity: DeployLintItem['severity'], code: string, message: string, t?: KeyedText): void => {
    out.push({ severity, code, message, ...(t ? { swf: t.swf, nodeId: t.nodeId, layerName: t.layer } : {}) })
  }

  const seen = new Map<string, KeyedText>()
  const fromGraphs = new Map<string, KeyedText>()
  for (const t of texts.filter((x) => x.graph)) {
    if (t.kind === 'hudWidget') item('warning', 'loc-needs-runtime', `${t.layer}: a HUD widget has no Inkwell Runtime, so Set Text shows the key ${t.key} itself.`, t)
    if (!fromGraphs.has(t.key.toLowerCase())) fromGraphs.set(t.key.toLowerCase(), t)
  }
  for (const t of texts.filter((x) => !x.graph)) {
    if (!LOC_KEY.test(t.key)) {
      item('error', 'loc-key-invalid', `"${t.layer}": the localization key "${t.key}" must be $ followed by letters, digits or _ (at most 96).`, t)
      continue
    }
    if (t.kind === 'hudWidget') item('warning', 'loc-needs-runtime', `"${t.layer}": a HUD widget has no Inkwell Runtime, so its key ${t.key} is not translated; the source text ${JSON.stringify(t.text)} is shown.`, t)
    const lower = t.key.toLowerCase()
    const first = seen.get(lower)
    if (first && first.text !== t.text) item('error', 'loc-key-duplicate', `"${t.layer}": the key ${t.key} is also used by "${first.layer}" with different text (${JSON.stringify(first.text)} and ${JSON.stringify(t.text)}). One key has one text.`, t)
    else if (!first) seen.set(lower, t)
  }

  const valid = [...seen.values(), ...[...fromGraphs].filter(([k]) => !seen.has(k)).map(([, t]) => t)]
  if (!loc) {
    if (valid.length) item('warning', 'loc-translation-missing', `The project has ${valid.length} keyed text(s) but no translations (localization.json); players see the source text.`)
    return out
  }

  const entries = new Map(Object.entries(loc.entries).map(([k, v]) => [k.toLowerCase(), { key: k, row: v }]))
  for (const t of valid) {
    const e = entries.get(t.key.toLowerCase())
    if (t.graph) {
      // a graph key has no Figma text: without a source cell the runtime file lacks the key and the player sees "$KEY"
      if (!(e?.row[loc.source] ?? '')) item('warning', 'loc-translation-missing', `${t.layer}: the key ${t.key} has no ${loc.source} text in the Localization table; players see the key itself.`, t)
      continue
    }
    if (e && (e.row[loc.source] ?? '') !== t.text && !(e.row[loc.source] === undefined && t.text === '')) item('warning', 'loc-source-changed', `"${t.layer}": the ${loc.source} text of ${t.key} (${JSON.stringify(e.row[loc.source] ?? '')}) differs from the text in Figma (${JSON.stringify(t.text)}).`, t)
  }
  for (const lang of loc.languages.filter((l) => l !== loc.source)) {
    const missing = valid.filter((t) => !(entries.get(t.key.toLowerCase())?.row[lang] ?? '')).map((t) => t.key)
    if (missing.length) item('warning', 'loc-translation-missing', `${lang}: ${missing.length} key(s) have no translation (${list(missing)}); players with this language see the ${loc.source} text.`)
  }
  const used = new Set(valid.map((t) => t.key.toLowerCase()))
  const orphans = [...entries.values()].filter((e) => !used.has(e.key.toLowerCase())).map((e) => e.key)
  if (orphans.length) item('warning', 'loc-key-orphan', `${orphans.length} translation key(s) are not used by any text layer (${list(orphans)}).`)
  return out
}
