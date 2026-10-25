import type { OverlayDoc } from './overlay'

/**
 * Data binding (design spec, Overlay `dataBinding`): a component property bound to a graph variable or a mock data field. The Spec types the overlay
 * entry's `dataBinding` as ONE string, so the bindings of a layer are written as `;`-separated `<property>=<source>:<name>`, e.g.
 * `text=var:score;alpha=mock:hp` (`var:` a graph variable id, `mock:` a mock data key). A part this parser does not understand is kept (`rest`)
 * and written back, never dropped.
 */
export const BINDABLE = ['text', 'visible', 'alpha', 'tint'] as const
export type BindProp = (typeof BINDABLE)[number]
export interface Binding {
  prop: BindProp
  source: 'var' | 'mock'
  name: string
}
export const BIND_NAME = /^[A-Za-z0-9_.-]+$/

export function parseBindings(s: unknown): { bindings: Binding[]; rest: string[] } {
  const bindings: Binding[] = []
  const rest: string[] = []
  for (const part of typeof s === 'string' ? s.split(';') : []) {
    if (part === '') continue
    const m = /^([a-z]+)=(var|mock):(.+)$/.exec(part)
    if (m && (BINDABLE as readonly string[]).includes(m[1]!) && BIND_NAME.test(m[3]!) && !bindings.some((b) => b.prop === m[1])) bindings.push({ prop: m[1] as BindProp, source: m[2] as Binding['source'], name: m[3]! })
    else rest.push(part)
  }
  return { bindings, rest }
}

/** The string for the overlay (`undefined` = no bindings left: remove the key). Bindings keep the order of BINDABLE. */
export function formatBindings(bindings: readonly Binding[], rest: readonly string[] = []): string | undefined {
  const parts = [...BINDABLE.flatMap((p) => bindings.filter((b) => b.prop === p).map((b) => `${b.prop}=${b.source}:${b.name}`)), ...rest]
  return parts.length ? parts.join(';') : undefined
}

/** Sets (or, with `null`, removes) the binding of one property in an overlay entry's `dataBinding` string. Returns the new string or undefined. */
export function withBinding(current: unknown, prop: BindProp, next: Omit<Binding, 'prop'> | null): string | undefined {
  const { bindings, rest } = parseBindings(current)
  return formatBindings([...bindings.filter((b) => b.prop !== prop), ...(next ? [{ prop, ...next }] : [])], rest)
}

/** Mock data: key -> scalar, per SWF, in the overlay document's top-level `mockData` (it joins the SWF's undo history and is not shipped: Ruffle Play mode only). */
export type MockValue = string | number | boolean
export type MockData = Record<string, MockValue>
export const mockDataOf = (doc: OverlayDoc | undefined): MockData => {
  const m = doc?.['mockData']
  if (!m || typeof m !== 'object' || Array.isArray(m)) return {}
  return Object.fromEntries(Object.entries(m).filter((e): e is [string, MockValue] => ['string', 'number', 'boolean'].includes(typeof e[1])))
}
export const withMockData = (doc: OverlayDoc, data: MockData): OverlayDoc => {
  const { mockData: _old, ...rest } = doc
  return Object.keys(data).length ? { ...rest, mockData: data } : rest
}
/** Renames a key keeping its position; `undefined` removes it. Refuses a taken or invalid name (returns the data unchanged). */
export function setMockKey(data: MockData, key: string, next: string | undefined): MockData {
  if (next !== undefined && (!BIND_NAME.test(next) || (next !== key && Object.hasOwn(data, next)))) return data
  return Object.fromEntries(Object.entries(data).flatMap(([k, v]) => (k === key ? (next === undefined ? [] : [[next, v] as const]) : [[k, v] as const])))
}

/** The `dataBinding` strings of an overlay's node entries by node id (what codegen binds). */
export const bindingsOf = (nodes: Record<string, { dataBinding?: unknown }> | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(nodes ?? {}).flatMap(([id, o]) => (typeof o?.dataBinding === 'string' && o.dataBinding ? [[id, o.dataBinding]] : [])))
