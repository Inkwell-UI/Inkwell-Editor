/**
 * Mock data on a node input (Inspector): an unwired or wired data input can read a mock data field instead of its value, in the Ruffle preview only. The link is
 * kept in the node's `extra.pinMock` (`{ <input pin>: <mock key> }`; `extra` is the Spec's place for editor data, so this adds nothing to the format). Only
 * String, Number and Bool inputs can be bound, the types a mock field has.
 */
export const MOCK_PIN_TYPES = ['String', 'Number', 'Bool'] as const
export type MockPinType = (typeof MOCK_PIN_TYPES)[number]
export const isMockPinType = (t: string): t is MockPinType => (MOCK_PIN_TYPES as readonly string[]).includes(t)

/** The input pin -> mock key links of a node's `extra` (anything that is not a string is ignored, never dropped by `withPinMock`). */
export function pinMocksOf(extra: unknown): Record<string, string> {
  const m = (extra as { pinMock?: unknown } | undefined)?.pinMock
  if (!m || typeof m !== 'object' || Array.isArray(m)) return {}
  return Object.fromEntries(Object.entries(m).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== ''))
}

/** `extra` with the link of `pin` set (`undefined` removes it). Other keys of `extra`, and the pins of other links, stay. Returns undefined when `extra` ends up empty. */
export function withPinMock(extra: Record<string, unknown> | undefined, pin: string, key: string | undefined): Record<string, unknown> | undefined {
  const { pinMock: old, ...rest } = extra ?? {}
  const kept = old && typeof old === 'object' && !Array.isArray(old) ? (old as Record<string, unknown>) : {}
  const { [pin]: _gone, ...others } = kept
  const next = key === undefined ? others : { ...others, [pin]: key }
  const out = Object.keys(next).length ? { ...rest, pinMock: next } : rest
  return Object.keys(out).length ? out : undefined
}

/** AS2 for the mock field `key` read as `type` (the mock bridge stores whatever the editor sent, so the value is coerced here like a variable's). */
export function mockRead(type: MockPinType, expr: string): string {
  return type === 'Number' ? `Number(${expr})` : type === 'String' ? `String(${expr})` : `(${expr} == true || ${expr} == "true")`
}
