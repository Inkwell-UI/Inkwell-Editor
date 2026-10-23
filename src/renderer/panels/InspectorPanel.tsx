import { useState } from 'react'
import { CircleX, Lock, Redo2, TriangleAlert, Undo2, Info } from 'lucide-react'
import type { Node } from '@inkwell-ui/spec'
import { describeTextMapping } from '../../main/swf/text'
import { ident, instanceNameError, ROLES } from '../../shared/overlay'
import type { FontRow } from '../../shared/syncState'
import { useUndo } from '../hooks/useUndo'
import { useActiveOverlay, useActiveSwf, useDockRows } from '../hooks/useProject'
import { useSyncState } from '../hooks/useSyncState'
import type { DockRow } from '../model/lintRows'
import { editNode } from '../state/overlayStore'
import { useSelectionStore } from '../state/selectionStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Panel } from './Panel'

const RULE: Record<FontRow['via'], 1 | 2 | 3 | 4> = { 'text style': 1, 'family/style': 2, fallback: 3, unmapped: 4 }

const SeverityIcon = ({ s }: { s: DockRow['severity'] }) =>
  s === 'error' ? <CircleX size={14} className="tone-error" aria-hidden="true" /> : s === 'warning' ? <TriangleAlert size={14} className="tone-warn" aria-hidden="true" /> : <Info size={14} className="tone-info" aria-hidden="true" />

/**
 * Zone 5 (UX 4.5): shows the selected component, or the selected graph node. For a component, in this order: issues for this node,
 * Inkwell-derived facts (GFx mapping, font resolution), the editable behavior overlay (role, instance name; the rest disabled with reasons),
 * and last the collapsed read-only Figma Source card. There are no transform or colour inputs anywhere: Figma owns the visuals.
 */
export function InspectorPanel() {
  const inspects = useSelectionStore((s) => s.inspects)
  const component = useSelectionStore((s) => s.component)
  const graphNode = useSelectionStore((s) => s.graphNode)
  const issue = useSelectionStore((s) => s.issue)
  const swf = useActiveSwf()
  const node = component ? swf?.ir.nodes[component] : undefined

  if (inspects === 'graphNode')
    return (
      <Panel title={strings.insp.title}>
        <p className="empty">{strings.insp.graphNode(graphNode)}</p>
      </Panel>
    )
  if (!node || !swf)
    return (
      <Panel title={strings.insp.title}>
        <p className="empty">{strings.insp.none}</p>
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
  const undo = useUndo()

  return (
    <div className="insp">
      <header className="insp-head">
        <div>
          <h3 className="insp-name">{node.name}</h3>
          <span className="dim mono">{strings.insp.nodeId(node.id)}</span>
        </div>
        <span className="chip">{strings.nav.typeNames[node.type] ?? node.type}</span>
      </header>
      <div className="row-actions"><Btn reason={strings.selectInFigmaReason}>{strings.selectInFigma}</Btn></div>

      <section aria-labelledby="insp-issues">
        <h4 id="insp-issues">{strings.insp.issues(rows.length)}</h4>
        {rows.length === 0 && <p className="empty">{strings.insp.noIssues}</p>}
        <ul className="plain">
          {rows.map((r) => (
            <li key={r.key} className={`issue${highlight === r.key ? ' is-highlighted' : ''}`}>
              <SeverityIcon s={r.severity} />
              <span className="mono">{r.code}</span>
              <span>{r.message}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="insp-gfx">
        <h4 id="insp-gfx">{strings.insp.gfx}</h4>
        {node.type === 'text' ? <TextMapping node={node} /> : <p className="empty">{strings.insp.gfxNone(strings.nav.typeNames[node.type] ?? node.type)}</p>}
      </section>

      {node.type === 'text' && (
        <section aria-labelledby="insp-font">
          <h4 id="insp-font">{strings.insp.font}</h4>
          {font ? (
            <dl className="facts">
              <dt>{strings.insp.fontStyle}</dt><dd>{font.styleName ?? strings.insp.fontNoStyle}</dd>
              <dt>{strings.insp.fontFamily}</dt><dd>{font.figmaFont}</dd>
              <dt>{strings.insp.fontResolved}</dt><dd className="mono">{font.alias ?? strings.unmapped}</dd>
              <dt>{strings.insp.fontRule}</dt>
              <dd className={RULE[font.via] === 4 ? 'tone-error' : RULE[font.via] === 3 ? 'tone-warn' : undefined}>{strings.insp.fontRules[RULE[font.via]]}</dd>
            </dl>
          ) : <p className="empty">{strings.insp.fontNone}</p>}
        </section>
      )}

      <section aria-labelledby="insp-overlay" className="overlay-section">
        <div className="section-title">
          <h4 id="insp-overlay">{strings.insp.overlay}</h4>
          <span className="row-actions">
            <Btn icon={Undo2} label={strings.insp.undo} reason={undo.canUndo ? undefined : strings.insp.nothingToUndo} onClick={undo.undo} testId="overlay-undo" />
            <Btn icon={Redo2} label={strings.insp.redo} reason={undo.canRedo ? undefined : strings.insp.nothingToRedo} onClick={undo.redo} testId="overlay-redo" />
          </span>
        </div>
        <p className="dim">{strings.insp.overlayNote}</p>
        <RoleField swfId={swfId} nodeId={node.id} role={entry.role} />
        <InstanceNameField swfId={swfId} nodeId={node.id} layerName={node.name} value={entry.instanceName} />
        <p className="dim contract">{strings.insp.contractLine}</p>
        {strings.insp.disabledControls.map((c) => (
          <div key={c.label} className="field">
            <span className="field-label">{c.label}</span>
            <Btn label={c.label} reason={c.reason}>{c.value}</Btn>
          </div>
        ))}
      </section>

      <details className="source" data-testid="figma-source">
        <summary><Lock size={13} aria-hidden="true" /> {strings.insp.source}</summary>
        <p className="dim">{strings.insp.sourceNote}</p>
        <dl className="facts">
          <dt>{strings.insp.srcType}</dt><dd>{node.type}</dd>
          <dt>{strings.insp.srcPosition}</dt><dd className="mono">{node.transform.x}, {node.transform.y}</dd>
          <dt>{strings.insp.srcSize}</dt><dd className="mono">{node.transform.width} x {node.transform.height}</dd>
          <dt>{strings.insp.srcRotation}</dt><dd className="mono">{node.transform.rotation}</dd>
          <dt>{strings.insp.srcConstraints}</dt><dd>{node.anchor.h} / {node.anchor.v}</dd>
          <dt>{strings.insp.srcVisible}</dt><dd>{node.visible ? strings.yes : strings.no}</dd>
          <dt>{strings.insp.srcOpacity}</dt><dd className="mono">{node.opacity}</dd>
        </dl>
        <Btn icon={Lock} reason={strings.focusInFigmaReason}>{strings.focusInFigma}</Btn>
      </details>
    </div>
  )
}

function TextMapping({ node }: { node: Extract<Node, { type: 'text' }> }) {
  const f = describeTextMapping(node)
  const flags = f.sizing.flags
  const to = flags.autoSize
    ? ['autoSize', flags.wordWrap ? 'wordWrap' : strings.insp.noWrap, flags.multiline && flags.wordWrap && 'multiline'].filter(Boolean).join(', ')
    : `${strings.insp.fixedField}${flags.wordWrap ? ` (${strings.insp.wraps})` : ''}`
  return (
    <dl className="facts">
      <dt>{strings.insp.sizing}</dt><dd>{strings.insp.sizingNames[f.sizing.value]} <span className="arrow" aria-label={strings.insp.mapsTo}>&rarr;</span> {to}</dd>
      {f.verticalAlign && <><dt>{strings.insp.vAlign}</dt><dd>{strings.insp.alignNames[f.verticalAlign]} <span className="arrow" aria-label={strings.insp.mapsTo}>&rarr;</span> {strings.insp.gfxVerticalAlign}</dd></>}
      {f.textAutoSize && <><dt>{strings.insp.fit}</dt><dd>{f.textAutoSize} <span className="arrow" aria-label={strings.insp.mapsTo}>&rarr;</span> {strings.insp.gfxTextAutoSize}</dd></>}
      {f.letterSpacingPx !== undefined && <><dt>{strings.insp.spacing}</dt><dd>{f.letterSpacingPx} px <span className="arrow" aria-label={strings.insp.mapsTo}>&rarr;</span> letterSpacing</dd></>}
      {f.truncate && <><dt>{strings.insp.truncate}</dt><dd className="tone-warn">{strings.insp.truncateNote}</dd></>}
    </dl>
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
      <label className="field-label" htmlFor="instance-name">{strings.insp.instanceName}</label>
      <input
        id="instance-name"
        className={err ? 'is-invalid' : undefined}
        value={text}
        placeholder={def}
        spellCheck={false}
        aria-invalid={!!err}
        aria-describedby="instance-name-help"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setDraft(undefined)
        }}
        data-testid="instance-name"
      />
      <p id="instance-name-help" className={err ? 'tone-error' : 'dim'}>{err ? strings.insp.instanceNameErrors[err] : strings.insp.instanceNameHelp(def)}</p>
    </div>
  )
}
