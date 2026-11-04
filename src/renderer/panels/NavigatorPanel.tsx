import { useGraphFollow } from '../state/graphFollow'
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, CircleX, Component, Sparkles, DollarSign, FileCode, Frame, Gamepad2, Image as ImageIcon, Link2, Shapes, TriangleAlert, Type, Workflow, type LucideIcon } from 'lucide-react'
import { useComponentIr } from '../hooks/useComponentIr'
import { useOpenComponent } from '../hooks/useOpenComponent'
import { useSwfGraphs } from '../hooks/useGraphs'
import { useActiveOverlay, useActiveSwf, useDockRows, useProject } from '../hooks/useProject'
import { useSyncState } from '../hooks/useSyncState'
import { buildLayerTree, filterTree, flattenTree, runtimeMatches, withRuntimeRows, type Badge, type LayerRow } from '../model/layerTree'
import { computeOrphans } from '../model/orphans'
import { inkwell } from '../hooks/api'
import { openLayerGraph } from '../state/graphDocs'
import { figmaSelectReason } from '../model/connection'
import { discardOrphanSwf, discardOverlayOrphan, relinkOverlayOrphan } from '../state/orphanActions'
import { useSelectionStore } from '../state/selectionStore'
import { useToastStore } from '../state/toastStore'
import { useTraceStore } from '../state/traceStore'
import { strings } from '../../shared/strings'
import { Btn } from '../ui/Btn'
import { RowContextMenu, type RowMenuItem } from '../ui/RowMenu'
import { SearchBox } from '../ui/SearchBox'
import { FigmaSelectBtn } from '../ui/FigmaSelectBtn'
import { Panel } from './Panel'

const SWF_VALUE = '@swf' // the select value of the active SWF (a component id never starts with @)

const TYPE_ICON: Record<string, LucideIcon> = { frame: Frame, text: Type, shape: Shapes, image: ImageIcon, component: Component, instance: Workflow }

const BADGE: Record<Badge['kind'], { icon: LucideIcon; label: string; cls: string }> = {
  error: { icon: CircleX, label: strings.nav.badgeError, cls: 'badge-error' },
  warning: { icon: TriangleAlert, label: strings.nav.badgeWarning, cls: 'badge-warning' },
  placeholder: { icon: DollarSign, label: strings.nav.badgePlaceholder, cls: 'badge-dim' },
  script: { icon: FileCode, label: strings.nav.badgeScript, cls: 'badge-dim' },
  link: { icon: Link2, label: strings.nav.badgeLink, cls: 'badge-dim' },
  pad: { icon: Gamepad2, label: strings.nav.badgePad, cls: 'badge-dim' }
}

function Badges({ badges }: { badges: Badge[] }) {
  return (
    <span className="badges">
      {badges.map((b) => {
        const d = BADGE[b.kind]
        const text = `${d.label}${b.count && b.count > 1 ? ` (${b.count})` : ''}`
        return (
          <span key={b.kind} className={`badge ${d.cls}`} title={text} role="img" aria-label={text}>
            <d.icon size={12} aria-hidden="true" />
            {b.count && b.count > 1 ? b.count : null}
          </span>
        )
      })}
    </span>
  )
}

/**
 * Zone 2, tab 1 (UX 4.2): LAYERS (the active SWF's IR tree with badges), ORPHANED OVERLAYS and
 * UNREACHABLE FIGMA LAYERS. Data: the project (IR, overlay), the single lint source (`useDockRows`) and the sync state. Selecting a row
 * goes through the selection store (source `navigator`).
 */
export function NavigatorPanel() {
  const project = useProject()
  const swf = useActiveSwf()
  const overlay = useActiveOverlay()
  const rows = useDockRows()
  const sync = useSyncState()
  const selected = useSelectionStore((s) => s.component)
  const select = useSelectionStore((s) => s.selectComponent)
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; id: string; name: string }>()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  const lint = useMemo(() => rows.filter((r) => swf && r.swfName === swf.name && r.nodeId).map((r) => ({ nodeId: r.nodeId!, severity: r.severity })), [rows, swf])
  const comp = useComponentIr() // a component's graph is open: the layers are what the component is made of, not the menu
  const { rows: compRows, openGraph, openMenu } = useOpenComponent()
  const meta = useSwfGraphs().store?.getState().meta
  const compId = meta?.scope === 'blueprint' && typeof meta.component === 'string' ? meta.component : undefined
  const tree = useMemo(
    () => (comp === 'unavailable' ? undefined : comp ? buildLayerTree(comp.ir, comp.inSwf ? (overlay ?? swf?.overlay) : undefined, []) : swf ? buildLayerTree(swf.ir, overlay ?? swf.overlay, lint) : undefined),
    [comp, swf, overlay, lint]
  )
  const spawned = useTraceStore((s) => s.spawned)
  const nameOf = (id: string): string => sync?.pageComponents?.find((c) => c.id === id)?.name ?? id
  const q = query.trim().toLowerCase()
  // a layer stays in a filtered list when an instance a graph made under it matches
  const filtered = tree ? filterTree(tree, query, (id) => !comp && spawned.some((s) => s.parent === id && runtimeMatches(nameOf(s.component), q))) : undefined
  const designRows: LayerRow[] = filtered ? flattenTree(filtered, collapsed, query.trim() !== '') : []
  // the instances a graph made while the preview runs, under the layer they were added to (not in a component's own layer list)
  const flat = comp ? designRows : withRuntimeRows(designRows, spawned, nameOf, query)
  // layers of components kept on the Figma page (in no SWF) are live, so their overlay entries are not orphans
  const pageIds = useMemo(() => new Set([...(sync?.pageComponents ?? []).map((c) => c.id), ...(sync?.pageComponentTrees ?? []).flatMap((t) => Object.keys(t.nodes))]), [sync?.pageComponents, sync?.pageComponentTrees])
  const orphans = useMemo(() => computeOrphans((project?.swfs ?? []).map((s) => (s.id === swf?.id && overlay ? { ...s, overlay } : s)), pageIds), [project, swf, overlay, pageIds])
  const unreachable = [...(sync?.looseLayers ?? []).map((l) => ({ ...l, note: strings.nav.unreachableLoose })), ...(sync?.unreachableNodes ?? []).map((l) => ({ id: l.id, name: l.name, note: strings.nav.unreachableInSwf(l.swfName) }))]

  // right-click on a layer: its graph, its name, and Figma (only while a plugin can be reached; the Inspector's button says why when it cannot)
  const figmaReason = figmaSelectReason(sync, { notConnected: strings.selectInFigmaReason, pending: strings.selectInFigmaPending })
  const menuItems = (id: string, name: string): RowMenuItem[] => [
    ...(swf ? [{ label: strings.nav.openGraph, ...(comp ? { disabled: strings.nav.openGraphComponent } : {}), onClick: () => void openLayerGraph({ id: swf.id, name: swf.name, root: swf.ir.root }, id, name) }] : []),
    { label: strings.nav.copyName, onClick: () => void navigator.clipboard.writeText(name).catch(() => undefined) },
    { label: strings.selectInFigma, ...(figmaReason ? { disabled: figmaReason } : {}), onClick: () => void inkwell?.selectInFigma(id, true).then((r) => { if (!r.ok) useToastStore.getState().push({ tone: 'error', title: strings.selectInFigmaFailed(r.error) }) }) }
  ]
  const toggle = (id: string): void => setCollapsed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const onKey = (e: React.KeyboardEvent<HTMLUListElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-layer-id]'))
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next = items[Math.min(items.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]
    if (next) {
      e.preventDefault()
      next.focus()
    }
  }

  return (
    <Panel title={strings.nav.title}>
      <div className="nav">
        {swf && (compRows.length > 0 || compId) && (
          <select className="nav-source" aria-label={strings.nav.source} value={compId ?? SWF_VALUE} onChange={(e) => (e.target.value === SWF_VALUE ? openMenu() : void openGraph(e.target.value, compRows.find((r) => r.id === e.target.value)?.name ?? e.target.value))}>
            <option value={SWF_VALUE}>{swf.name}</option>
            <hr />
            {compId && !compRows.some((r) => r.id === compId) && <option value={compId}>{comp && comp !== 'unavailable' ? comp.name : compId}</option>}
            {compRows.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
        <SearchBox value={query} onChange={setQuery} label={strings.nav.search} />

        <section aria-label={strings.nav.layers}>
          {comp === 'unavailable' ? (
            <p className="empty">{strings.nav.componentUnknown}</p>
          ) : !swf ? (
            <p className="empty">{strings.nav.noSwf}</p>
          ) : flat.length ? (
            <ul className="tree" role="tree" aria-label={strings.nav.layers} onKeyDown={onKey}>
              {flat.map((r) => {
                const Icon = TYPE_ICON[r.type] ?? Frame
                if (r.runtime)
                  return (
                    <li key={r.id} role="none">
                      <div className={`layer-row is-runtime${selected === r.id ? ' is-selected' : ''}`} role="treeitem" aria-level={r.depth + 1} aria-selected={selected === r.id} style={{ paddingLeft: 4 + r.depth * 14 }} title={strings.nav.runtimeTip} data-testid="layer-runtime">
                        <span className="twisty" aria-hidden="true" />
                        <button type="button" className="layer-main" data-layer-id={r.id} onClick={() => select(r.id, 'navigator')}>
                          <Sparkles size={14} aria-hidden="true" className="type-icon" />
                          <span className="layer-name">{r.name}</span>
                          <span className="layer-type">{strings.nav.runtimeTag}</span>
                        </button>
                      </div>
                    </li>
                  )
                return (
                  <li key={r.id} role="none">
                    <div className={`layer-row${selected === r.id ? ' is-selected' : ''}`} role="treeitem" aria-level={r.depth + 1} aria-selected={selected === r.id} aria-expanded={r.hasChildren ? r.expanded : undefined} style={{ paddingLeft: 4 + r.depth * 14 }} onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, id: r.id, name: r.name }) }}>
                      {r.hasChildren ? (
                        <button type="button" className="twisty" onClick={() => toggle(r.id)} aria-label={r.expanded ? strings.nav.collapse(r.name) : strings.nav.expand(r.name)} title={r.expanded ? strings.nav.collapse(r.name) : strings.nav.expand(r.name)} tabIndex={-1}>
                          {r.expanded ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
                        </button>
                      ) : <span className="twisty" aria-hidden="true" />}
                      <button type="button" className="layer-main" data-layer-id={r.id} onClick={(e) => (e.ctrlKey || e.metaKey ? useGraphFollow.getState().skipNext() : undefined, select(r.id, 'navigator'))} title={strings.nav.layerTip}>
                        <Icon size={14} aria-hidden="true" className="type-icon" />
                        <span className="layer-name">{r.name}</span>
                        <span className="layer-type">{strings.nav.typeNames[r.type] ?? r.type}</span>
                      </button>
                      <Badges badges={r.badges} />
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="empty">{query.trim() ? strings.nav.noMatch : strings.nav.noLayers}</p>
          )}
        </section>

        {menu && <RowContextMenu key={`${menu.x},${menu.y}`} label={strings.nav.menuLabel} at={menu} items={menuItems(menu.id, menu.name)} onClose={() => setMenu(undefined)} />}
        {orphans.length > 0 && <section aria-labelledby="nav-orphans">
          <header className="section-title"><h3 id="nav-orphans">{strings.nav.orphans(orphans.length)}</h3></header>
          {orphans.map((o) => {
            // an overlay entry can only be edited once its SWF's overlay store exists, i.e. while it is the active SWF
            const notActive = o.kind === 'overlay' && o.swfId !== swf?.id ? strings.nav.openSwfFirst : undefined
            const relinkReason = o.kind === 'swf' ? strings.nav.relinkSwfReason : notActive ?? (selected ? undefined : strings.nav.relinkNeedsSelection)
            return (
              <div key={o.kind === 'swf' ? o.swfId : `${o.swfId}/${o.nodeId}`} className="card">
                <div className="card-head">
                  <TriangleAlert size={14} aria-hidden="true" className="tone-warn" />
                  <strong>{o.kind === 'swf' ? strings.nav.orphanSwf(o.swfName) : strings.nav.orphanNode(o.nodeId)}</strong>
                </div>
                <p className="dim">{o.kind === 'swf' ? strings.nav.orphanSwfNote : strings.nav.orphanHas(o.held)}</p>
                <div className="row-actions">
                  <Btn
                    reason={relinkReason}
                    onClick={() => {
                      if (o.kind !== 'overlay' || !swf || !selected || !inkwell) return
                      void relinkOverlayOrphan(swf, o.nodeId, selected, inkwell).then((r) => {
                        if (!r.ok) useToastStore.getState().push({ tone: 'error', title: strings.nav.relinkFailed[r.error] ?? r.error })
                      })
                    }}
                  >
                    {strings.nav.relink}
                  </Btn>
                  <Btn
                    variant="danger"
                    reason={notActive}
                    onClick={() => {
                      if (o.kind === 'overlay') return void (window.confirm(strings.nav.discardConfirm(o.nodeId)) && discardOverlayOrphan(o.swfId, o.nodeId))
                      void discardOrphanSwf({ id: o.swfId, name: o.swfName })
                    }}
                  >
                    {strings.nav.discard}
                  </Btn>
                </div>
              </div>
            )
          })}
        </section>}

        {unreachable.length > 0 && <section aria-labelledby="nav-unreachable">
          <header className="section-title"><h3 id="nav-unreachable">{strings.nav.unreachable(unreachable.length)}</h3></header>
          {unreachable.map((u) => (
            <div key={u.id} className="card">
              <div className="card-head">
                <TriangleAlert size={14} aria-hidden="true" className="tone-warn" />
                <strong>{u.name}</strong>
                <span className="dim mono">{u.id}</span>
              </div>
              <p className="dim">{u.note}</p>
              <div className="row-actions"><FigmaSelectBtn nodeId={u.id} /></div>
            </div>
          ))}
        </section>}
      </div>
    </Panel>
  )
}
