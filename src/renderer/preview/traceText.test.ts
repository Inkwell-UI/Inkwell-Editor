import { describe, expect, it } from 'vitest'
import { traceTextOf } from './RuffleBackend'

describe('traceTextOf (Ruffle 0.7.1 console format)', () => {
  const css = ['color: whitesmoke; background: #444', 'color: gray; font-style: italic', 'color: inherit']
  it('takes the trace text after the log_adapter target', () => {
    expect(traceTextOf(['%cINFO%c web/src/log_adapter.rs:18%c [Inkwell] info log: shown', ...css])).toBe('[Inkwell] info log: shown')
    expect(traceTextOf(['%cINFO%c web/src/log_adapter.rs:18%c plain trace', ...css])).toBe('plain trace')
  })
  it('ignores Ruffle\'s own messages and unrelated console output', () => {
    expect(traceTextOf(['%cINFO%c core/src/context.rs:364%c Loaded SWF version 10', ...css])).toBeUndefined()
    expect(traceTextOf(['%cWARN%c core/src/avm1/runtime.rs:384%c Avm1::pop: Stack underflow', ...css])).toBeUndefined()
    expect(traceTextOf(['Loading SWF data'])).toBeUndefined()
    expect(traceTextOf([{ a: 1 }])).toBeUndefined()
  })
  it('accepts a bare line with the marker', () => {
    expect(traceTextOf(['[Inkwell] error x: y'])).toBe('[Inkwell] error x: y')
  })
})
