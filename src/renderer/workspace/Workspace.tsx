import { Fragment, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
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
}

interface Ctx {
  registry: Record<string, PanelDef>
  onResize: (key: string, sizes: number[] | undefined) => void
  onTab: (key: string, panel: string) => void
}

/**
 * Renders any layout: splits become flex containers with draggable splitters between their children, tab groups become one slot with a
 * tab strip, panels become registry components. A bad layout shows its problems instead of a half-built window. This is the one component
 * to replace if a docking library is adopted; layouts and panels stay as they are.
 */
export function Workspace({ layout, registry = panelRegistry, onResize = () => undefined, onTab = () => undefined }: WorkspaceProps) {
  const errors = validateLayout(layout, registry === panelRegistry ? panelIds : Object.keys(registry))
  if (errors.length)
    return (
      <div role="alert" className="layout-error">
        <h2>{strings.layoutInvalid}</h2>
        <ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul>
      </div>
    )
  return (
    <div className="workspace">
      <Node node={layout} ctx={{ registry, onResize, onTab }} axis="row" />
    </div>
  )
}

const cellStyle = (node: LayoutNode, extra: CSSProperties = {}): CSSProperties => ({ flex: `${node.size ?? 1} 1 0`, ...extra })

function Node({ node, ctx, axis }: { node: LayoutNode; ctx: Ctx; axis: 'row' | 'column' }) {
  if (node.kind === 'panel') {
    const def = ctx.registry[node.panel]!
    const Component = def.component
    // The slot is sized by its share along the parent's axis; the panel inside fills it and scrolls by itself.
    return (
      <div className="slot" data-cell data-panel={node.panel} style={cellStyle(node, { minWidth: def.minSize.width, minHeight: def.minSize.height })}>
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
    <div ref={ref} className="split" data-cell style={cellStyle(node, { flexDirection: node.direction })}>
      {node.children.map((c, i) => (
        <Fragment key={c.kind === 'panel' ? c.panel : `${c.kind}${i}`}>
          <Node node={c} ctx={ctx} axis={node.direction} />
          {i < node.children.length - 1 && (
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
  const move = (e: ReactKeyboardEvent, i: number): void => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const next = node.tabs[(i + d + node.tabs.length) % node.tabs.length]!.panel
    ctx.onTab(key, next)
    requestAnimationFrame(() => document.getElementById(`tab-${next}`)?.focus())
  }
  return (
    <div className="slot tabgroup" data-cell data-tabs={key} style={cellStyle(node, { minWidth: min.w, minHeight: min.h + 28 })}>
      <div className="tablist" role="tablist" aria-label={node.tabs.map((t) => ctx.registry[t.panel]!.title).join(', ')}>
        {node.tabs.map((t, i) => (
          <TabButton key={t.panel} id={t.panel} def={ctx.registry[t.panel]!} selected={t.panel === active} onSelect={() => ctx.onTab(key, t.panel)} onKeyDown={(e) => move(e, i)} />
        ))}
      </div>
      <div className="tabbody" role="tabpanel" aria-labelledby={`tab-${active}`} data-panel={active}>
        <Body />
      </div>
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
