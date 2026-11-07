import { Fragment, useEffect, useState } from 'react'
import { CircleX, Focus, Lock, TriangleAlert, Info, X } from 'lucide-react'
import { FOCUS_DIRS, FOCUS_NONE, focusGraph, type Localization, isThemeBindingKey, KEY_LABEL, LOC_KEY, PROMPT_ACTIONS, PROMPT_DEFAULTS, PS_GLYPHS, suggestKey, uniqueKey, XBOX_GLYPHS, type Node } from '@inkwell-ui/spec'
import { bindingMode, themeVariable } from '../../shared/theme'
import { describeTextMapping } from '../../shared/textMapping'
import { CHARSETS, EMBEDDED_FONTS_UI } from '../../shared/fonts'
import { keyedTexts } from '../../shared/localizationLint'
import { widgetFrame } from '../../shared/widgetFrame'
import { ensureKey, removeKey, renameKey, setCell } from '../../shared/localizationOps'
import { debugHotkeyOf, ident, instanceNameError, ROLES, widgetAnchorOf, type WidgetAnchor } from '../../shared/overlay'
import type { FontRow } from '../../shared/syncState'
import { parseBindings } from '../../shared/graphBinding'
import { BindingRows } from '../graph/BindingRows'
import { GraphNodeInspector } from '../graph/GraphNodeInspector'
import { OpenComponentProps } from '../graph/PropsEditor'
import { useComponentIr } from '../hooks/useComponentIr'
import { useActiveOverlay, useActiveSwf, useDockRows, useProject } from '../hooks/useProject'
import { useSyncState } from '../hooks/useSyncState'
import type { DockRow } from '../model/lintRows'
import { useFontStore } from '../state/fontStore'
import { defaultTable, useLocalizationStore } from '../state/localizationStore'
import { editNode, getOverlayDoc } from '../state/overlayStore'
import { useSelectionStore } from '../state/selectionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { languageCode } from '../preview/locale'
import { TextCell } from '../ui/TextCell'
import { strings } from '../../shared/strings'
import { Btn } from '../ui/Btn'
import { InspFold, InspFoot, InspHeader } from '../ui/InspParts'
import { Tip } from '../ui/Tip'
import { FigmaSelectBtn } from '../ui/FigmaSelectBtn'
import { Panel } from './Panel'

const RULE: Record<FontRow['via'], 1 | 2 | 3 | 4 | 5> = { 'text style': 1, 'family/style': 2, fallback: 3, unmapped: 4, embedded: 5 }

const INSP_TABS = ['behavior', 'translations', 'game', 'figma'] as const

/** The text of `key` in `lang` (the key matches ignoring case, like the engine). */
const cellOf = (loc: Localization, key: string | undefined, lang: string): string =>
  key ? Object.entries(loc.entries).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1][lang] ?? '' : ''

/** How many languages other than the source have no text for `key`; loads localization.json for the open project. */
function useMissingTranslations(key: string | undefined): number {
  const project = useProject()
  const loc = useLocalizationStore((s) => s.localization)
  const load = useLocalizationStore((s) => s.load)
  useEffect(() => void (project?.dir && load()), [project?.dir, load])
  return loc && key ? loc.languages.filter((l) => l !== loc.source && cellOf(loc, key, l) === '').length : 0
}

const SeverityIcon =({ s }: { s: DockRow['severity'] }) =>
  s === 'error' ? <CircleX size={14} className="tone-error" aria-hidden="true" /> : s === 'warning' ? <TriangleAlert size={14} className="tone-warn" aria-hidden="true" /> : <Info size={14} className="tone-info" aria-hidden="true" />

/**
 * Zone 5 (UX 4.5): shows the selected component, or the selected graph node. For a component, three tabs: Behavior (the editable overlay: role,
 * script name, focus, data, layout), In game (issues for this node, GFx mapping, font match) and Figma (read-only source values).
 * There are no transform or colour inputs anywhere: Figma owns the visuals.
 */
export function InspectorPanel() {
  const inspects = useSelectionStore((s) => s.inspects)
  const component = useSelectionStore((s) => s.component)
  const graphNode = useSelectionStore((s) => s.graphNode)
  const issue = useSelectionStore((s) => s.issue)
  const swf = useActiveSwf()
  const comp = useComponentIr()
  const root = comp && comp !== 'unavailable' ? comp.ir : swf?.ir // the tree the Navigator shows: the open component's layers, else the menu's
  const node = component ? root?.nodes[component] : undefined

  if (inspects === 'graphNode')
    return (
      <Panel title={strings.insp.title}>
        <GraphNodeInspector />
      </Panel>
    )
  if (!node || !swf)
    return (
      <Panel title={strings.insp.title}>
        <OpenComponentProps>
          <p className="empty">{strings.insp.none}</p>
        </OpenComponentProps>
      </Panel>
    )
  return (
    <Panel title={strings.insp.title}>
      <ComponentInspector key={`${swf.id}/${node.id}`} swfName={swf.name} swfId={swf.id} node={node} highlight={issue} />
    </Panel>
  )
}

function ComponentInspector({ swfName, swfId, node, highlight }: { swfName: string; swfId: string; node: Node; highlight: string | undefined }) {
  const sync = useSyncState()
  const rows = useDockRows().filter((r) => r.swfName === swfName && r.nodeId === node.id)
  const overlay = useActiveOverlay()
  const entry = (overlay?.nodes?.[node.id] ?? {}) as { role?: string; instanceName?: string }
  const font = sync?.fonts?.find((f) => f.swfName === swfName && f.nodeId === node.id)
  const swf = useActiveSwf()
  const isPrompt = entry.role === 'prompt'
  const isWidgetFrame = swf?.ir.target.kind === 'hudWidget' && widgetFrame(swf.ir)?.frame.id === node.id
  const [tab, setTab] = useState<(typeof INSP_TABS)[number]>(highlight ? 'game' : 'behavior') // a click on an issue in the Lint dock lands on the tab that lists it
  const boundCount = parseBindings((entry as { dataBinding?: string }).dataBinding).bindings.length

  const showGame = rows.length > 0 || node.type === 'text' || node.type === 'frame'
  const locKey = (entry as { locKey?: string }).locKey
  const missingTr = useMissingTranslations(locKey)
  const tabs = INSP_TABS.filter((t) => t !== 'translations' || node.type === 'text') // only a text layer has something to translate

  return (
    <div className="insp insp-fill">
      <InspHeader title={node.name} sub={strings.nav.typeNames[node.type] ?? node.type} action={<FigmaSelectBtn nodeId={node.id} />} />
      <div className="insp-tabs" role="tablist" aria-label={strings.insp.title}>
        {tabs.map((t) => (
          <button key={t} type="button" id={`insp-tab-${t}`} className="tab" role="tab" aria-selected={tab === t} tabIndex={tab === t ? 0 : -1} onClick={() => setTab(t)} data-testid={`insp-tab-${t}`}>
            {strings.insp.tabs[t]}
            {t === 'game' && rows.length > 0 && <span className="tab-badge">{rows.length}</span>}
            {t === 'translations' && missingTr > 0 && <span className="tab-badge" title={strings.loc.missingCount(missingTr)}>{missingTr}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-labelledby={`insp-tab-${tab}`}>
      {tab === 'game' && (
        <>
          {rows.length > 0 && (
            <ul className="plain">
              {rows.map((r) => (
                <li key={r.key} className={`issue${highlight === r.key ? ' is-highlighted' : ''}`}>
                  <SeverityIcon s={r.severity} />
                  <span className="issue-text">
                    <span className="mono">{r.code}</span>
                    <span>{r.message}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {node.type === 'text' ? <TextMapping node={node} /> : node.type === 'frame' ? <FrameMapping node={node} isRoot={swf?.ir.root === node.id} /> : null}
          {node.type === 'text' && (font ? (
            <dl className="facts">
              <dt>{strings.insp.fontStyle}</dt><dd>{font.styleName ?? strings.insp.fontNoStyle}</dd>
              <dt>{strings.insp.fontFamily}</dt><dd>{font.figmaFont}</dd>
              <dt>{strings.insp.fontResolved}</dt><dd className="mono">{font.embedded ? `embedded: ${font.embedded}` : font.alias ?? strings.unmapped}</dd>
              <dt>{strings.insp.fontRule}</dt>
              <dd className={RULE[font.via] === 4 ? 'tone-error' : RULE[font.via] === 3 ? 'tone-warn' : undefined}>{strings.insp.fontRules[RULE[font.via]]}</dd>
            </dl>
          ) : <p className="empty">{strings.insp.fontNone}</p>)}
          {!showGame && <p className="empty">{strings.insp.gameNone}</p>}
        </>
      )}

      {tab === 'behavior' && (
        <>
        <InspFold id="identity" title={strings.insp.groupIdentity} summary={entry.role ? strings.insp.roleNames[entry.role] ?? entry.role : strings.insp.noRole} defaultOpen>
          <RoleField swfId={swfId} nodeId={node.id} role={entry.role} />
          {entry.role === 'list' && node.type === 'frame' && <ListField swfId={swfId} nodeId={node.id} value={(entry as { list?: { itemTemplate?: string; spacing?: number } }).list} children={node.children.flatMap((c) => swf?.ir.nodes[c] ?? [])} />}
          {entry.role === 'scrollbar' && node.type === 'frame' && <ScrollbarField swfId={swfId} nodeId={node.id} value={(entry as { scrollbar?: { target?: string; orientation?: 'vertical' | 'horizontal' } }).scrollbar} targets={Object.values(swf?.ir.nodes ?? {}).filter((n) => n.type === 'frame' && (overlay?.nodes?.[n.id]?.role === 'list' || ('overflow' in n && n.overflow && n.overflow !== 'none')))} />}
          <InstanceNameField swfId={swfId} nodeId={node.id} layerName={node.name} value={entry.instanceName} />
        </InspFold>
        {isPrompt && (
          <InspFold id="prompt" title={strings.insp.prompt.title} summary={(entry as { prompt?: { action?: string } }).prompt?.action ?? strings.insp.prompt.actionNone} defaultOpen>
            <PromptField swfId={swfId} node={node} nodes={swf?.ir.nodes ?? {}} value={(entry as { prompt?: Record<string, string> }).prompt} />
          </InspFold>
        )}
        {swf?.ir.target.kind === 'customMenu' && (
          <InspFold id="focus" title={strings.insp.focus.label} summary={typeof (entry as { focus?: FocusValue }).focus?.order === 'number' ? strings.insp.focus.orderSummary((entry as { focus?: FocusValue }).focus!.order!) : strings.insp.focus.none} defaultOpen
            actions={typeof (entry as { focus?: FocusValue }).focus?.order === 'number' ? <Btn icon={X} label={strings.insp.focus.remove} variant="quiet" className="btn-hover-err" onClick={() => removeFocus(swfId, node.id, (entry as { focus?: FocusValue }).focus!)} testId="focus-remove" /> : undefined}>
            <FocusField swfId={swfId} nodeId={node.id} value={(entry as { focus?: FocusValue }).focus} />
          </InspFold>
        )}
        <InspFold id="data" title={strings.insp.groupData} summary={boundCount ? strings.bind.count(boundCount) : strings.insp.dataNone}>
          <BindingRows swfId={swfId} node={node} />
          <ThemeBindingsField node={node} />
          {EMBEDDED_FONTS_UI && node.type === 'text' && <EmbeddedFontField swfId={swfId} nodeId={node.id} value={(entry as { font?: string }).font} />}
        </InspFold>
        <InspFold id="layout" title={strings.insp.groupLayout} summary={isWidgetFrame ? strings.insp.widgetAnchorSummary : strings.insp.layoutDefault}>
          {isWidgetFrame && <WidgetAnchorField swfId={swfId} nodeId={node.id} value={widgetAnchorOf(entry)} />}
          {isWidgetFrame && <DebugHotkeyField swfId={swfId} nodeId={node.id} value={debugHotkeyOf(entry)} />}
          {strings.insp.disabledControls.filter((c, i) => !(isWidgetFrame && i === 0)).map((c) => (
            <div key={c.label} className="field">
              <span className="field-label">{c.label}</span>
              <Btn label={c.label} reason={c.reason}>{c.value}</Btn>
            </div>
          ))}
        </InspFold>
        </>
      )}

      {tab === 'translations' && node.type === 'text' && <TranslationsTab swfId={swfId} node={node} value={locKey} />}

      {tab === 'figma' && (
        <div data-testid="figma-source">
          <dl className="facts">
            <dt>{strings.insp.srcPosition}</dt><dd className="mono">{node.transform.x}, {node.transform.y}</dd>
            <dt>{strings.insp.srcSize}</dt><dd className="mono">{node.transform.width} x {node.transform.height}</dd>
            <dt>{strings.insp.srcRotation}</dt><dd className="mono">{node.transform.rotation}</dd>
            <dt>{strings.insp.srcConstraints}</dt><dd>{node.anchor.h} / {node.anchor.v}</dd>
            <dt>{strings.insp.srcVisible}</dt><dd>{node.visible ? strings.yes : strings.no}</dd>
            <dt>{strings.insp.srcOpacity}</dt><dd className="mono">{node.opacity}</dd>
          </dl>
          <p className="dim">{strings.insp.sourceNote}</p>
          <div className="row-actions"><FigmaSelectBtn nodeId={node.id} focus icon={Focus} /></div>
        </div>
      )}
      </div>
      <InspFoot text={node.id} title={strings.insp.nodeId(node.id)} copy={node.id} />
    </div>
  )
}

function TextMapping({ node }: { node: Extract<Node, { type: 'text' }> }) {
  const f = describeTextMapping(node)
  const flags = f.sizing.flags
  const detail = flags.wordWrap ? strings.insp.wraps : flags.autoSize ? strings.insp.noWrap : undefined
  return (
    <dl className="facts">
      <dt>{strings.insp.sizing}</dt><dd>{[strings.insp.sizingNames[f.sizing.value], detail].filter(Boolean).join(', ')}</dd>
      {f.verticalAlign && <><dt>{strings.insp.vAlign}</dt><dd>{strings.insp.alignNames[f.verticalAlign]}</dd></>}
      {f.textAutoSize && <><dt>{strings.insp.fit}</dt><dd>{f.textAutoSize}</dd></>}
      {f.letterSpacingPx !== undefined && <><dt>{strings.insp.spacing}</dt><dd>{f.letterSpacingPx} px</dd></>}
      {f.truncate && <><dt>{strings.insp.truncate}</dt><dd className="tone-warn">{strings.insp.truncateNote}</dd></>}
    </dl>
  )
}

/** A nested frame is a MovieClip: fills become clips under its children, clipContent a clip layer (swf/generate.ts `background`). */
function FrameMapping({ node, isRoot }: { node: Extract<Node, { type: 'frame' }>; isRoot: boolean }) {
  const fills = (node.fills ?? []).flatMap((f, i) => (f.type !== 'image' && isRoot ? [] : [<Fragment key={i}><dt>{strings.insp.gfxFrameFill(i + 1)}</dt><dd>{strings.insp.gfxFrameFillTo(f.type)}</dd></Fragment>]))
  return (
    <>
      {isRoot && <p className="dim">{strings.insp.gfxFrameRoot}</p>}
      {!isRoot && fills.length === 0 && !node.clipContent && <p className="empty">{strings.insp.gfxFrameNone}</p>}
      <dl className="facts">
        {fills}
        {node.clipContent && <><dt>{strings.insp.gfxFrameClip}</dt><dd>{strings.insp.gfxFrameClipTo}</dd></>}
      </dl>
    </>
  )
}

/** Item template (default: the first child) and row spacing of a list (SPEC-CHANGES S8). */
function ListField({ swfId, nodeId, value, children }: { swfId: string; nodeId: string; value: { itemTemplate?: string; spacing?: number } | undefined; children: { id: string; name: string }[] }) {
  const set = (patch: { itemTemplate?: string; spacing?: number }): void => {
    const next = { ...value, ...patch }
    if (next.itemTemplate === undefined || next.itemTemplate === '') delete next.itemTemplate
    if (next.spacing === undefined || !(next.spacing > 0)) delete next.spacing
    editNode(swfId, nodeId, { list: Object.keys(next).length ? next : null })
  }
  return (
    <>
      {children.length > 0 && (
      <label className="field">
        <span className="field-label">{strings.insp.listTemplate}</span>
        <select value={value?.itemTemplate ?? ''} onChange={(e) => set({ itemTemplate: e.target.value })} data-testid="list-template">
          <option value="">{strings.insp.listTemplateFirst}</option>
          {children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      )}
      <label className="field">
        <span className="field-label">{strings.insp.listSpacing}</span>
        <input className="gn-input" type="number" min={0} value={value?.spacing ?? 0} onChange={(e) => set({ spacing: Number(e.target.value) })} data-testid="list-spacing" />
      </label>
    </>
  )
}

/** The list or scrolling frame a scrollbar follows, and its direction (Spec overlay `scrollbar`); the frame needs a `thumb` child and optionally a `track` child. */
function ScrollbarField({ swfId, nodeId, value, targets }: { swfId: string; nodeId: string; value: { target?: string; orientation?: 'vertical' | 'horizontal' } | undefined; targets: { id: string; name: string }[] }) {
  const set = (patch: { target?: string; orientation?: string }): void => {
    const next = { ...value, ...patch } as { target?: string; orientation?: string }
    if (!next.orientation) delete next.orientation
    // the Spec requires a target, so without one the whole field goes
    editNode(swfId, nodeId, { scrollbar: next.target ? (next as { target: string; orientation?: 'vertical' | 'horizontal' }) : null })
  }
  return (
    <>
      <label className="field">
        <span className="field-label">{strings.insp.scrollbarTarget}</span>
        <select value={value?.target ?? ''} onChange={(e) => set({ target: e.target.value })} data-testid="scrollbar-target">
          <option value="">{strings.insp.scrollbarNoTarget}</option>
          {value?.target && !targets.some((t) => t.id === value.target) && <option value={value.target}>{value.target}</option>}
          {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span className="field-label">{strings.insp.scrollbarDirection}</span>
        <select value={value?.orientation ?? ''} onChange={(e) => set({ orientation: e.target.value })} data-testid="scrollbar-orientation">
          <option value="">{strings.insp.scrollbarAuto}</option>
          <option value="vertical">{strings.insp.scrollbarVertical}</option>
          <option value="horizontal">{strings.insp.scrollbarHorizontal}</option>
        </select>
      </label>
      <p className="dim">{strings.insp.scrollbarHint}</p>
    </>
  )
}

function RoleField({ swfId, nodeId, role }: { swfId: string; nodeId: string; role: string | undefined }) {
  const known: readonly string[] = ROLES
  return (
    <label className="field">
      <span className="field-label">{strings.insp.role}</span>
      <select value={role ?? ''} onChange={(e) => editNode(swfId, nodeId, { role: e.target.value || null })} data-testid="role-select">
        <option value="">{strings.insp.roleNone}</option>
        {role && !known.includes(role) && <option value={role}>{role}</option>}
        {ROLES.map((r) => <option key={r} value={r}>{strings.insp.roleNames[r]}</option>)}
      </select>
    </label>
  )
}

/**
 * Overlay `locKey` of a text layer (V2.1) and this layer's row of localization.json: the key, the text in every language (the source text comes from the layer),
 * adding a language, and a way into the full table. Setting a key also creates its row (the source text is the layer's text). The tab shows how many languages are missing.
 */
function TranslationsTab({ swfId, node, value }: { swfId: string; node: Extract<Node, { type: 'text' }>; value: string | undefined }) {
  const project = useProject()
  const loc = useLocalizationStore((s) => s.localization)
  const locError = useLocalizationStore((s) => s.error)
  const modId = useLocalizationStore((s) => s.modId)
  const setTable = useLocalizationStore((s) => s.set)
  const t = strings.insp.translations
  const langs = loc ? [loc.source, ...loc.languages.filter((l) => l !== loc.source)] : []
  const cell = (lang: string): string => (loc ? cellOf(loc, value, lang) : '')
  const missing = loc && value ? langs.filter((l) => l !== loc.source && cell(l) === '') : []
  const [draft, setDraft] = useState<string | undefined>()
  const text = draft ?? value ?? ''
  const others = keyedTexts((project?.swfs ?? []).map((s) => ({ name: s.name, kind: s.ir.target.kind, orphaned: s.orphaned, ir: s.ir, overlay: (getOverlayDoc(s.id)?.nodes ?? s.overlay.nodes ?? {}) as Record<string, Record<string, unknown>> }))).filter((t) => !(t.swf === (project?.swfs.find((s) => s.id === swfId)?.name) && t.nodeId === node.id))
  const err = draft === undefined || draft === '' ? undefined : !LOC_KEY.test(draft) ? strings.loc.keyInvalid : others.some((t) => t.key.toLowerCase() === draft.toLowerCase() && t.text !== node.content) ? strings.loc.keyTaken : undefined
  const apply = (key: string | null): void => {
    editNode(swfId, node.id, { locKey: key })
    const stillUsed = value !== undefined && others.some((t) => t.key.toLowerCase() === value.toLowerCase())
    if (!key) {
      if (value && loc && !stillUsed) setTable(removeKey(loc, value)) // removing the key removes its row, unless another layer shares it
      return
    }
    let table = loc ?? defaultTable(modId || 'Mod')
    if (value && value.toLowerCase() !== key.toLowerCase() && !stillUsed) table = renameKey(table, value, key)
    setTable(ensureKey(table, key, node.content))
  }
  const commit = (): void => {
    if (draft === undefined) return
    if (draft === '') apply(null)
    else if (!err && draft !== value) apply(draft)
    setDraft(undefined)
  }
  const suggest = (): void => {
    const ns = (loc ?? defaultTable(modId || 'Mod')).namespace
    apply(uniqueKey(suggestKey(ns, node.name), [...others.map((t) => t.key), ...Object.keys(loc?.entries ?? {})]))
  }
  return (
    <>
      {locError && <p className="tone-error">{strings.loc.unreadable(locError)}</p>}
      <div className="field">
        <label className="field-label" htmlFor="loc-key">{strings.loc.keyField}<Tip text={t.keyHelp} /></label>
        <div className="insp-loc-key">
          <input
            id="loc-key"
            className={err ? 'is-invalid' : undefined}
            value={text}
            placeholder="$"
            spellCheck={false}
            aria-invalid={!!err}
            {...(err ? { 'aria-describedby': 'loc-key-help' } : {})}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setDraft(undefined)
            }}
            data-testid="loc-key"
          />
          {value
            ? <Btn onClick={() => apply(null)} testId="loc-key-clear">{strings.loc.keyClear}</Btn>
            : <Btn onClick={suggest} testId="loc-key-suggest">{strings.loc.keySuggest}</Btn>}
        </div>
        {err && <p id="loc-key-help" className="tone-error">{err}</p>}
      </div>
      {!value && !locError && <p className="dim">{t.noKeyHelp}</p>}
      {value && !loc && !locError && <Btn onClick={() => useLocalizationStore.getState().create()} testId="loc-create-inline">{strings.loc.create}</Btn>}
      {value && loc && (
        <>
          <div className="insp-loc-list" data-testid="loc-languages">
            {langs.map((l) => (
              <div key={l} className="insp-loc-row">
                <span className="dim mono" title={l}>{languageCode(l)}</span>
                {l === loc.source
                  ? <span className="insp-loc-source" title={t.sourceTip}>{node.content}</span>
                  : <TextCell value={cell(l)} title={strings.loc.cellTitle(value, l)} onCommit={(v) => setTable(setCell(loc, value, l, v))} />}              </div>
            ))}
          </div>
          <div className="row-actions">
            <Btn variant="quiet" onClick={() => useWorkspaceStore.getState().setActive('localization')} testId="loc-open-table">{t.openTable}</Btn>
          </div>
        </>
      )}
    </>
  )
}

/** Overlay `font` of a text layer (V5.6): an embedded custom font of the project instead of a Skyrim alias. Settings (charsets, extra characters) belong to the font, not the layer. */
function EmbeddedFontField({ swfId, nodeId, value }: { swfId: string; nodeId: string; value: string | undefined }) {
  const project = useProject()
  const { fonts, load, add, saveSettings } = useFontStore()
  useEffect(() => void (project?.dir && load()), [project?.dir, load])
  const chosen = fonts.find((f) => f.hash === value)
  const [extra, setExtra] = useState<string | undefined>()
  const pick = async (): Promise<void> => {
    const h = await add()
    if (h) editNode(swfId, nodeId, { font: h })
  }
  const t = strings.insp.embeddedFont
  return (
    <div className="field">
      <label className="field-label" htmlFor="embedded-font">{t.label}</label>
      <select id="embedded-font" value={value ?? ''} onChange={(e) => editNode(swfId, nodeId, { font: e.target.value || null })} data-testid="embedded-font">
        <option value="">{t.none}</option>
        {value && !chosen && <option value={value}>{t.missing(value.slice(0, 8))}</option>}
        {fonts.map((f) => <option key={f.hash} value={f.hash}>{f.family}</option>)}
      </select>
      <span className="row-actions"><Btn onClick={() => void pick()} testId="embedded-font-add">{t.add}</Btn></span>
      {chosen ? (
        <>
          <dl className="facts">
            <dt>{t.licenseFlag}</dt>
            <dd className={chosen.license.level === 'error' ? 'tone-error' : chosen.license.level === 'warning' ? 'tone-warn' : undefined}>
              {chosen.fsTypeLabel}{chosen.license.text ? `: ${chosen.license.text}` : ''}
            </dd>
            <dt>{t.charsets}</dt>
            <dd>
              {Object.entries(CHARSETS).map(([id, c]) => (
                <label key={id} className="inline">
                  <input
                    type="checkbox" checked={chosen.charsets.includes(id)}
                    onChange={(e) => saveSettings(chosen.hash, { charsets: e.target.checked ? [...chosen.charsets, id] : chosen.charsets.filter((x) => x !== id), extraChars: chosen.extraChars })}
                  /> {c.label}
                </label>
              ))}
            </dd>
          </dl>
          <label className="field-label" htmlFor="embedded-extra">{t.extra}</label>
          <input
            id="embedded-extra" value={extra ?? chosen.extraChars} spellCheck={false} aria-describedby="embedded-extra-help"
            onChange={(e) => setExtra(e.target.value)}
            onBlur={() => { if (extra !== undefined && extra !== chosen.extraChars) saveSettings(chosen.hash, { charsets: chosen.charsets, extraChars: extra }); setExtra(undefined) }}
            data-testid="embedded-extra"
          />
          <p id="embedded-extra-help" className="dim">{t.extraHelp}</p>
          <p className="dim">{t.facts(chosen.glyphCount, Math.round(chosen.bytes / 1024))}</p>
        </>
      ) : <p className="dim">{t.help}</p>}
    </div>
  )
}

/** The node's Figma variable bindings (SPEC-CHANGES V6): read-only, they come from Figma. `runtime` = the INI Theme key changes it in game; `compile-time only` = the default theme is baked in. */
function ThemeBindingsField({ node }: { node: Node }) {
  const swf = useActiveSwf()
  const rows = Object.entries(node.bindings ?? {}).filter(([k]) => isThemeBindingKey(k))
  if (!swf || !rows.length) return null
  const t = strings.insp.themeBindings
  return (
    <div className="field" data-testid="theme-bindings">
      <span className="field-label">{t.label}</span>
      <ul className="plain">
        {rows.map(([key, ref]) => {
          const v = themeVariable(swf.ir, ref.id)
          const runtime = swf.ir.target.kind === 'customMenu' && bindingMode(key, node) === 'runtime'
          return (
            <li key={key}>
              <span className="mono">{key}</span> {v ? v.name : <span className="tone-warn">{t.missing}</span>}{' '}
              <span className={`chip ${runtime ? 'chip-ok' : ''}`}>{runtime ? t.runtime : t.compile}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function InstanceNameField({ swfId, nodeId, layerName, value }: { swfId: string; nodeId: string; layerName: string; value: string | undefined }) {
  const def = ident(layerName)
  const [draft, setDraft] = useState<string | undefined>()
  const text = draft ?? value ?? ''
  const err = draft !== undefined && draft !== '' ? instanceNameError(draft) : undefined
  const commit = (): void => {
    if (draft === undefined) return
    if (draft === '') editNode(swfId, nodeId, { instanceName: null }) // empty = back to the default
    else if (!instanceNameError(draft) && draft !== value) editNode(swfId, nodeId, { instanceName: draft })
    setDraft(undefined)
  }
  return (
    <div className="field">
      <label className="field-label" htmlFor="instance-name">{strings.insp.instanceName}<Tip text={strings.insp.instanceNameHelp(def)} /></label>
      <input
        id="instance-name"
        className={err ? 'is-invalid' : undefined}
        value={text}
        placeholder={def}
        spellCheck={false}
        aria-invalid={!!err}
        {...(err ? { 'aria-describedby': 'instance-name-help' } : {})}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setDraft(undefined)
        }}
        data-testid="instance-name"
      />
      {err && <p id="instance-name-help" className="tone-error">{strings.insp.instanceNameErrors[err]}</p>}
    </div>
  )
}

const POSITIONS = (['top', 'center', 'bottom'] as const).flatMap((v) => (['left', 'center', 'right'] as const).map((h) => ({ h, v })))
const DEFAULT_MARGIN = 24

/** Overlay `anchor` of a HUD widget's frame: one of 9 screen positions plus margins; "Figma position" removes the override. */
function WidgetAnchorField({ swfId, nodeId, value }: { swfId: string; nodeId: string; value: WidgetAnchor | undefined }) {
  const set = (a: WidgetAnchor | null): void => editNode(swfId, nodeId, { anchor: a })
  const pick = (key: string): void => {
    const p = POSITIONS.find((q) => `${q.v} ${q.h}` === key)
    set(p ? { ...p, x: value?.x ?? DEFAULT_MARGIN, y: value?.y ?? DEFAULT_MARGIN } : null)
  }
  const margin = (k: 'x' | 'y', text: string): void => {
    const n = Number(text)
    if (value && text.trim() !== '' && Number.isFinite(n) && n !== value[k]) set({ ...value, [k]: n })
  }
  return (
    <div className="field">
      <label className="field-label" htmlFor="widget-anchor">{strings.insp.widgetAnchor}</label>
      <select id="widget-anchor" value={value ? `${value.v} ${value.h}` : ''} onChange={(e) => pick(e.target.value)} aria-describedby="widget-anchor-help" data-testid="widget-anchor">
        <option value="">{strings.insp.widgetAnchorFigma}</option>
        {POSITIONS.map((p) => <option key={`${p.v} ${p.h}`} value={`${p.v} ${p.h}`}>{strings.insp.widgetAnchorNames[`${p.v} ${p.h}`]}</option>)}
      </select>
      {value && (
        <div className="field-row">
          {(['x', 'y'] as const).map((k) => (
            <label key={`${k}${value[k]}`} className="field-label">
              {k === 'x' ? strings.insp.widgetMarginX : strings.insp.widgetMarginY}
              <input
                type="number"
                defaultValue={value[k]}
                onBlur={(e) => margin(k, e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') margin(k, e.currentTarget.value) }}
                data-testid={`widget-margin-${k}`}
              />
            </label>
          ))}
        </div>
      )}
      <p id="widget-anchor-help" className="dim">{value ? strings.insp.widgetAnchorHelp : strings.insp.widgetAnchorFigmaHelp}</p>
    </div>
  )
}

/** Overlay `debugHotkey` of a HUD widget's frame (0 / empty = off). Invalid input is not saved. */
function DebugHotkeyField({ swfId, nodeId, value }: { swfId: string; nodeId: string; value: number }) {
  const commit = (text: string): void => {
    const n = Number(text)
    if (text.trim() === '') { if (value) editNode(swfId, nodeId, { debugHotkey: null }) }
    else if (Number.isInteger(n) && n >= 1 && n <= 255 && n !== value) editNode(swfId, nodeId, { debugHotkey: n })
  }
  return (
    <div className="field">
      <label className="field-label" htmlFor="debug-hotkey">{strings.insp.debugHotkey}</label>
      <input
        id="debug-hotkey"
        key={value}
        type="number"
        min={1}
        max={255}
        defaultValue={value || ''}
        aria-describedby="debug-hotkey-help"
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(e.currentTarget.value) }}
        data-testid="debug-hotkey"
      />
      <p id="debug-hotkey-help" className="dim">{strings.insp.debugHotkeyHelp}</p>
    </div>
  )
}

type FocusValue = { order?: number; overrides?: Record<string, string> } & Record<string, unknown>

/** Overlay `focus` (W3): the order and the four overrides; the default target of each direction comes from the Spec's `focusGraph`. Lint shows on the layer (Issues above). */
const DIR_ARROWS: Record<string, string> = { up: '\u2191', down: '\u2193', left: '\u2190', right: '\u2192' }

/** Takes the layer out of the focus order and drops its overrides; other keys of `focus` stay. */
function removeFocus(swfId: string, nodeId: string, value: FocusValue): void {
  const { order: _a, overrides: _b, ...rest } = value
  editNode(swfId, nodeId, { focus: Object.keys(rest).length ? rest : null })
}

function FocusField({ swfId, nodeId, value }: { swfId: string; nodeId: string; value: FocusValue | undefined }) {
  const overlay = useActiveOverlay()
  const swf = useActiveSwf()
  const t = strings.insp.focus
  if (!swf) return null
  const nodes = (overlay?.nodes ?? {}) as Record<string, { focus?: unknown }>
  const g = focusGraph(nodes, (id) => id in swf.ir.nodes)
  const name = (id: string): string => swf.ir.nodes[id]?.name ?? id
  const set = (next: FocusValue | null): void => editNode(swfId, nodeId, { focus: next })
  if (typeof value?.order !== 'number') {
    const max = Math.max(0, ...g.order.map((id) => (nodes[id]?.focus as { order: number }).order))
    return (
      <div className="field">
        <span className="row-actions"><Btn onClick={() => set({ ...value, order: max + 1 })} testId="focus-add">{t.add}</Btn><Tip text={t.help} /></span>
      </div>
    )
  }
  const setOverride = (d: string, target: string): void => {
    const o = { ...value.overrides }
    if (target) o[d] = target
    else delete o[d]
    const { overrides: _o, ...rest } = value
    set(Object.keys(o).length ? { ...rest, overrides: o } : rest)
  }
  return (
    <div className="field" data-testid="focus-field">
      <div className="focus-moves">
        <label className="focus-move">
          <span className="focus-dir">{t.order}<Tip text={t.help} /></span>
          <input key={value.order} type="number" defaultValue={value.order} data-testid="focus-order"
            onBlur={(e) => { const n = Number(e.target.value); if (e.target.value.trim() !== '' && Number.isFinite(n) && n !== value.order) set({ ...value, order: n }) }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
        </label>
        {FOCUS_DIRS.map((d) => (
          <label key={d} className="focus-move">
            <span className="focus-dir"><span aria-hidden="true">{DIR_ARROWS[d]}</span>{t.dirs[d]}</span>
            <select className={value.overrides?.[d] ? undefined : 'focus-auto'} value={value.overrides?.[d] ?? ''} onChange={(e) => setOverride(d, e.target.value)} data-testid={`focus-${d}`}>
              <option value="">{t.dflt(name(g.moves[nodeId]?.[d] ?? nodeId))}</option>
              <option value={FOCUS_NONE}>{t.stay}</option>
              {value.overrides?.[d] && value.overrides[d] !== FOCUS_NONE && !g.order.includes(value.overrides[d]!) && <option value={value.overrides[d]}>{name(value.overrides[d]!)}</option>}
              {g.order.filter((id) => id !== nodeId).map((id) => <option key={id} value={id}>{name(id)}</option>)}
            </select>
          </label>
        ))}
      </div>
    </div>
  )
}

/**
 * The Prompt card (W4) of a layer with role Prompt: its action, the glyph per device, and which of its own layers is the icon place and which is the text (both optional: a layer named
 * promptIcon, the first text layer). Only the prompt's children are offered. Overlay `prompt`: action, keyboard, xbox, playstation, icon, label (Spec `PromptOverlay`).
 */
function PromptField({ swfId, node, nodes, value }: { swfId: string; node: Node; nodes: Record<string, Node>; value: Record<string, string> | undefined }) {
  const t = strings.insp.prompt
  const nodeId = node.id
  const [key, setKey] = useState<string>()
  const action = value?.['action'] ?? ''
  const dflt = (PROMPT_DEFAULTS as Record<string, Record<string, string>>)[action]
  const set = (k: string, v: string): void => {
    const next = { ...value }
    if (v) next[k] = v
    else delete next[k]
    editNode(swfId, nodeId, { prompt: Object.keys(next).length ? next : null })
  }
  const kids = node.children.flatMap((c) => nodes[c] ?? [])
  const layerSelect = (k: 'icon' | 'label', none: string, only?: string) => {
    const cur = value?.[k] ?? ''
    const choices = kids.filter((n) => !only || n.type === only)
    const auto = k === 'icon' ? kids.find((n) => n.name === 'promptIcon')?.name : kids.find((n) => n.type === 'text')?.name
    return (
      <div className="prompt-field">
        <div className="prompt-lbl"><span>{t[k]}</span>{k === 'label' && <span>{t.optional}</span>}</div>
        <select value={cur} onChange={(e) => set(k, e.target.value)} className={cur ? undefined : 'prompt-default'} data-testid={`prompt-${k}`}>
          <option value="">{auto ? t.byDefault(auto) : none}</option>
          {cur && !choices.some((n) => n.id === cur) && <option value={cur}>{t.missing(cur)}</option>}
          {choices.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
      </div>
    )
  }
  const keyErr = key !== undefined && key !== '' && !KEY_LABEL.test(key)
  const glyphSelect = (d: 'xbox' | 'playstation', list: readonly string[]) => (
    <select value={value?.[d] ?? ''} onChange={(e) => set(d, e.target.value)} className={value?.[d] ? undefined : 'prompt-default'} aria-label={strings.stage.promptDevices[d]} data-testid={`prompt-${d}`}>
      <option value="">{dflt?.[d] ?? t.noDefault}</option>
      {list.map((g) => <option key={g} value={g}>{g}</option>)}
    </select>
  )
  return (
    <>
      <div className="prompt-field">
        <div className="prompt-lbl"><span>{t.action}</span></div>
        <select value={action} onChange={(e) => set('action', e.target.value)} data-testid="prompt-action">
          <option value="">{t.actionNone}</option>
          {action && !(PROMPT_ACTIONS as readonly string[]).includes(action) && <option value={action}>{action}</option>}
          {PROMPT_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      <div className="prompt-field">
        <div className="prompt-lbl"><span>{t.shows}</span></div>
        <div className="prompt-glyphs">
          <input value={key ?? value?.['keyboard'] ?? ''} placeholder={dflt?.['keyboard'] ?? ''} className={keyErr ? 'is-invalid' : undefined} aria-invalid={keyErr} aria-label={strings.stage.promptDevices['keyboard']} spellCheck={false} data-testid="prompt-keyboard"
            onChange={(e) => setKey(e.target.value)}
            onBlur={() => { if (key !== undefined && !keyErr) set('keyboard', key); setKey(undefined) }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setKey(undefined) }} />
          {glyphSelect('xbox', XBOX_GLYPHS)}
          {glyphSelect('playstation', PS_GLYPHS)}
        </div>
        <div className="prompt-glyphs prompt-sub">{(['keyboard', 'xbox', 'playstation'] as const).map((d) => <span key={d}>{strings.stage.promptDevices[d]}</span>)}</div>
        {keyErr && <p className="tone-error">{t.keyHelp}</p>}
      </div>
      {layerSelect('icon', t.iconNone)}
      {layerSelect('label', t.labelNone, 'text')}
    </>
  )
}
