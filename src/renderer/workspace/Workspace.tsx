import { Fragment, useEffect, useRef, type ComponentType, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { strings } from '../strings'
import { nodeKey, validateLayout, type LayoutNode, type SplitNode, type TabsNode } from './layout'
import { panelIds, panelRegistry, type PanelDef } from './panelRegistry'

/** Props of Workspace. */
export interface WorkspaceProps {
  /** What to show where (plain data, see layout.ts). */
  layout: LayoutNode
  /** Which panels exist. Defaults to the app's registry. */
  registry?: Record<string, PanelDef>
  /** A splitter was dragged: new sizes (px, one per child) of the split with this key; `undefined` resets that split. */
  onResize?(key: string, sizes: number[] | undefined): void
  /** A tab was chosen in the tab group with this key. */
  onTab?(key: string, panel: string): void
  /** A foldable tab group was folded or opened (see `foldable` in layout.ts). */
  onFold?(key: string, folded: boolean): void
  /** Extra content at the right of a folded tab group's strip, found by any panel id in the group. */
  stripExtras?: Record<string, ComponentType>
  /** Nodes with an `edge` leave the flow and slide in over the rest from their side (the fullscreen graph). */
  overlayEdges?: boolean
}

interface Ctx {
  stripExtras: Record<string, ComponentType>
  registry: Record<string, PanelDef>
  onResize: (key: string, sizes: number[] | undefined) => void
  onTab: (key: string, panel: string) => void
  onFold: (key: string, folded: boolean) => void
}

/**
 * Renders any layout: splits become flex containers with draggable splitters between their children, tab groups become one slot with a
 * tab strip, panels become registry components. A bad layout shows its problems instead of a half-built window. This is the one component
 * to replace if a docking library is adopted; layouts and panels stay as they are.
 */
export function Workspace({ layout, registry = panelRegistry, onResize = () => undefined, onTab = () => undefined, onFold = () => undefined, stripExtras = {}, overlayEdges = false }: WorkspaceProps) {
  useEffect(() => {
    if (!overlayEdges) return
    // a window that is not maximised: the cursor flicked out sideways ends :hover, so the side panel the cursor was heading for stays open (data-keep) until it comes back
    const edge = (side: string): HTMLElement | null => document.querySelector(`.workspace[data-overlay] [data-edge="${side}"]`)
    const clear = (): void => document.querySelectorAll('[data-keep]').forEach((el) => el.removeAttribute('data-keep'))
    const out = (e: MouseEvent): void => {
      if (e.relatedTarget) return
      const r = document.querySelector('.workspace')?.getBoundingClientRect()
      if (!r) return
      const hovered = document.querySelector<HTMLElement>('.workspace[data-overlay] [data-edge="left"]:hover, .workspace[data-overlay] [data-edge="right"]:hover')
      const side = e.clientX <= r.left + 60 ? 'left' : e.clientX >= r.right - 60 ? 'right' : undefined
      ;(hovered ?? (side && edge(side)))?.setAttribute('data-keep', '')
    }
    // a native dropdown popup takes the hover and a re-render after the pick can drop the focus: pin the panel open (data-hold) from a press inside it until a press outside
    const hold = (e: PointerEvent): void => {
      document.querySelectorAll('[data-hold]').forEach((el) => el.removeAttribute('data-hold'))
      if (e.target instanceof Element) e.target.closest('.workspace[data-overlay] [data-edge="left"], .workspace[data-overlay] [data-edge="right"]')?.setAttribute('data-hold', '')
    }
    document.addEventListener('mouseout', out)
    document.addEventListener('mousemove', clear)
    document.addEventListener('pointerdown', hold, true)
    return () => {
      document.removeEventListener('mouseout', out)
      document.removeEventListener('mousemove', clear)
      document.removeEventListener('pointerdown', hold, true)
      clear()
      document.querySelectorAll('[data-hold]').forEach((el) => el.removeAttribute('data-hold'))
    }
  }, [overlayEdges])
  const errors = validateLayout(layout, registry === panelRegistry ? panelIds : Object.keys(registry))
  if (errors.length)
    return (
      <div role="alert" className="layout-error">
        <h2>{strings.layoutInvalid}</h2>
        <ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul>
      </div>
    )
  return (
    <div className="workspace" data-overlay={overlayEdges || undefined}>
      <Node node={layout} ctx={{ registry, onResize, onTab, onFold, stripExtras }} axis="row" />
    </div>
  )
}

const cellStyle = (node: LayoutNode, extra: CSSProperties = {}): CSSProperties => ({ flex: `${node.size ?? 1} 1 0`, ...extra })
const isFolded = (n: LayoutNode): boolean => n.kind === 'tabs' && !!n.foldable && !!n.folded
/** A slot with a fixed extent along its parent's axis: no share, no splitter beside it. */
const isFixed = (n: LayoutNode): boolean => (n.kind === 'panel' && !!n.fixed) || isFolded(n)

function Node({ node, ctx, axis }: { node: LayoutNode; ctx: Ctx; axis: 'row' | 'column' }) {
  if (node.kind === 'panel') {
    const def = ctx.registry[node.panel]!
    const Component = def.component
    // The slot is sized by its share along the parent's axis; the panel inside fills it and scrolls by itself.
    // A fixed panel keeps its px extent along the parent's axis (no share, no splitter).
    const style = node.fixed
      ? axis === 'row'
        ? { flex: `0 0 ${node.fixed}px`, width: node.fixed, minWidth: node.fixed, minHeight: def.minSize.height }
        : { flex: `0 0 ${node.fixed}px`, height: node.fixed, minHeight: node.fixed, minWidth: def.minSize.width }
      : cellStyle(node, { minWidth: def.minSize.width, minHeight: def.minSize.height })
    return (
      <div className="slot" data-cell data-panel={node.panel} data-fixed={node.fixed || undefined} data-edge={node.edge} style={style}>
        <Component />
      </div>
    )
  }
  if (node.kind === 'tabs') return <TabGroup node={node} ctx={ctx} />
  return <SplitView node={node} ctx={ctx} axis={axis} />
}

const MIN_CELL = 48
const STEP = 24

function SplitView({ node, ctx }: { node: SplitNode; ctx: Ctx; axis: 'row' | 'column' }) {
  const ref = useRef<HTMLDivElement>(null)
  const horizontal = node.direction === 'row'
  const key = nodeKey(node)

  const measure = (): { sizes: number[]; mins: number[] } => {
    const cells = Array.from(ref.current?.querySelectorAll<HTMLElement>(':scope > [data-cell]') ?? [])
    return {
      sizes: cells.map((c) => (horizontal ? c.getBoundingClientRect().width : c.getBoundingClientRect().height)),
      mins: cells.map((c) => {
        const cs = getComputedStyle(c)
        return Math.max(MIN_CELL, parseFloat(horizontal ? cs.minWidth : cs.minHeight) || 0)
      })
    }
  }
  /** Moves the boundary after child `i` to give child i `a` px (clamped by both minimums). */
  const moveTo = (i: number, sizes: number[], mins: number[], want: number): void => {
    const total = sizes[i]! + sizes[i + 1]!
    const a = Math.min(Math.max(want, mins[i]!), total - mins[i + 1]!)
    const next = [...sizes]
    next[i] = Math.max(a, 1)
    next[i + 1] = Math.max(total - a, 1)
    ctx.onResize(key, next)
  }
  const onPointerDown = (i: number) => (e: ReactPointerEvent) => {
    e.preventDefault()
    const { sizes, mins } = measure()
    const start = horizontal ? e.clientX : e.clientY
    document.body.classList.add(horizontal ? 'dragging-col' : 'dragging-row')
    const move = (ev: PointerEvent): void => moveTo(i, sizes, mins, sizes[i]! + ((horizontal ? ev.clientX : ev.clientY) - start))
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('dragging-col', 'dragging-row')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const onKeyDown = (i: number) => (e: ReactKeyboardEvent) => {
    const dir = (horizontal ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 })[e.key as 'ArrowLeft']
    if (!dir) return
    e.preventDefault()
    const { sizes, mins } = measure()
    moveTo(i, sizes, mins, sizes[i]! + dir * STEP)
  }

  return (
    <div ref={ref} className="split" data-cell data-edge={node.edge} style={cellStyle(node, { flexDirection: node.direction })}>
      {node.children.map((c, i) => (
        <Fragment key={c.kind === 'panel' ? c.panel : `${c.kind}${i}`}>
          <Node node={c} ctx={ctx} axis={node.direction} />
          {i < node.children.length - 1 && !isFixed(c) && !isFixed(node.children[i + 1]!) && (
            <div
              className={`splitter ${horizontal ? 'splitter-col' : 'splitter-row'}`}
              role="separator"
              aria-orientation={horizontal ? 'vertical' : 'horizontal'}
              aria-label={strings.splitterLabel}
              title={strings.splitterTitle}
              tabIndex={0}
              onPointerDown={onPointerDown(i)}
              onKeyDown={onKeyDown(i)}
              onDoubleClick={() => ctx.onResize(key, undefined)}
            />
          )}
        </Fragment>
      ))}
    </div>
  )
}

function TabGroup({ node, ctx }: { node: TabsNode; ctx: Ctx }) {
  const key = nodeKey(node)
  const active = node.active && node.tabs.some((t) => t.panel === node.active) ? node.active : node.tabs[0]!.panel
  const def = ctx.registry[active]!
  const Body = def.component
  const min = node.tabs.reduce((m, t) => ({ w: Math.max(m.w, ctx.registry[t.panel]!.minSize.width), h: Math.max(m.h, ctx.registry[t.panel]!.minSize.height) }), { w: 0, h: 0 })
  const folded = isFolded(node)
  const move = (e: ReactKeyboardEvent, i: number): void => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const next = node.tabs[(i + d + node.tabs.length) % node.tabs.length]!.panel
    ctx.onTab(key, next)
    requestAnimationFrame(() => document.getElementById(`tab-${next}`)?.focus())
  }
  const select = (panel: string): void => {
    // the open tab of a foldable group folds it again
    if (node.foldable && !folded && panel === active) return ctx.onFold(key, true)
    ctx.onTab(key, panel)
    if (folded) ctx.onFold(key, false)
  }
  const tablist = (
    <div className="tablist" role="tablist" aria-label={node.tabs.map((t) => ctx.registry[t.panel]!.title).join(', ')}>
      {node.tabs.map((t, i) => (
        <TabButton key={t.panel} id={t.panel} def={ctx.registry[t.panel]!} selected={!folded && t.panel === active} onSelect={() => select(t.panel)} onKeyDown={(e) => move(e, i)} />
      ))}
    </div>
  )
  // A folded group is only its tab strip; it keeps that height and the neighbour takes the rest.
  const style = folded ? { flex: '0 0 auto', minWidth: min.w } : cellStyle(node, { minWidth: min.w, minHeight: min.h + 28 })
  const label = folded ? strings.dockShow : strings.dockHide
  const Extra = folded ? node.tabs.map((t) => ctx.stripExtras[t.panel]).find(Boolean) : undefined
  return (
    <div className="slot tabgroup" data-cell data-tabs={key} data-folded={folded || undefined} data-edge={node.edge} style={style}>
      {node.foldable ? (
        <div className="tabstrip">
          {tablist}
          {Extra && <Extra />}
          <button type="button" className="tab-fold" title={label} aria-label={label} aria-expanded={!folded} onClick={() => ctx.onFold(key, !folded)} data-testid={`fold-${key}`}>
            {folded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          </button>
        </div>
      ) : tablist}
      {!folded && (
        <div className="tabbody" role="tabpanel" aria-labelledby={`tab-${active}`} data-panel={active}>
          <Body />
        </div>
      )}
    </div>
  )
}

function TabButton(p: { id: string; def: PanelDef; selected: boolean; onSelect(): void; onKeyDown(e: ReactKeyboardEvent): void }) {
  const info = p.def.useTabInfo?.() ?? {}
  const label = info.label ?? p.def.title
  const disabled = !!info.disabledReason
  return (
    <button
      id={`tab-${p.id}`}
      className="tab"
      role="tab"
      aria-selected={p.selected}
      aria-disabled={disabled || undefined}
      tabIndex={p.selected ? 0 : -1}
      title={info.disabledReason ?? label}
      data-testid={`tab-${p.id}`}
      onClick={() => !disabled && p.onSelect()}
      onKeyDown={p.onKeyDown}
    >
      {label}
      {info.badge && <span className="tab-badge">{info.badge}</span>}
    </button>
  )
}
