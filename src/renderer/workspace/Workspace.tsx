import type { CSSProperties } from 'react'
import { strings } from '../strings'
import { defaultLayout, validateLayout, type LayoutNode } from './layout'
import { panelIds, panelRegistry, type PanelDef } from './panelRegistry'

/** Props of Workspace. */
export interface WorkspaceProps {
  /** What to show where (plain data, see layout.ts). */
  layout?: LayoutNode
  /** Which panels exist. Defaults to the app's registry. */
  registry?: Record<string, PanelDef>
}

/**
 * Renders any layout: splits become flex containers, panels become registry components. A bad layout shows its problems instead of a
 * half-built window. This is the one component to replace if a docking library is adopted; layouts and panels stay as they are.
 */
export function Workspace({ layout = defaultLayout, registry = panelRegistry }: WorkspaceProps) {
  const errors = validateLayout(layout, registry === panelRegistry ? panelIds : Object.keys(registry))
  if (errors.length)
    return (
      <div role="alert" className="layout-error">
        <h2>{strings.layoutInvalid}</h2>
        <ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul>
      </div>
    )
  return <Node node={layout} registry={registry} axis="row" />
}

function Node({ node, registry, axis }: { node: LayoutNode; registry: Record<string, PanelDef>; axis: 'row' | 'column' }) {
  if (node.kind === 'panel') {
    const def = registry[node.panel]!
    const Component = def.component
    // The slot is sized along the parent's axis; the panel inside fills it and scrolls by itself.
    const style: CSSProperties = {
      flex: `${node.size ?? 1} 1 ${axis === 'row' ? def.defaultSize.width : def.defaultSize.height}px`,
      minWidth: def.minSize.width,
      minHeight: def.minSize.height
    }
    return (
      <div className="slot" style={style} data-panel={node.panel}>
        <Component />
      </div>
    )
  }
  const style: CSSProperties = { flex: `${node.size ?? 1} 1 0`, flexDirection: node.direction }
  return (
    <div className="split" style={style}>
      {node.children.map((c, i) => (
        <Node key={c.kind === 'panel' ? c.panel : i} node={c} registry={registry} axis={node.direction} />
      ))}
    </div>
  )
}
