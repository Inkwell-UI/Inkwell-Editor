import { describe, expect, it } from 'vitest'
import type { PreviewBuild } from '../../shared/preview'
import type { PreviewBackend, PreviewBackendEvents } from './backend'
import { createPreviewController } from './controller'

function fakeBackend(loadImpl: (b: PreviewBuild) => Promise<void> = async () => {}) {
  const subs: { [E in keyof PreviewBackendEvents]: Set<(v: PreviewBackendEvents[E]) => void> } = { loaded: new Set(), error: new Set(), firstFrame: new Set() }
  const loads: number[] = []
  let disposed = false
  const backend: PreviewBackend = {
    element: {} as HTMLElement,
    load: (b) => (loads.push(b.seq), loadImpl(b)),
    on: (e, cb) => (subs[e].add(cb as never), () => subs[e].delete(cb as never)),
    dispose: () => (disposed = true)
  }
  const emit = <E extends keyof PreviewBackendEvents>(e: E, v: PreviewBackendEvents[E]): void => subs[e].forEach((cb) => (cb as (v: unknown) => void)(v))
  return { backend, loads, emit, isDisposed: () => disposed }
}
const build = (seq: number, over: Partial<PreviewBuild> = {}): PreviewBuild => ({ seq, swfId: 's', name: 'hud', stage: { width: 1920, height: 1080 }, notes: { textExtensions: 0, textNodes: 0 }, bytes: new ArrayBuffer(4), ...over })

function setup(loadImpl?: (b: PreviewBuild) => Promise<void>) {
  const f = fakeBackend(loadImpl)
  let t = 100
  const reports: unknown[] = []
  const c = createPreviewController({ backend: f.backend, report: (r) => reports.push(r), now: () => t })
  return { ...f, c, reports, tick: (n: number) => (t += n) }
}

describe('preview controller', () => {
  it('loads a build, measures build-ready -> first frame and reports it', async () => {
    const s = setup()
    const seen: string[] = []
    s.c.subscribe(() => seen.push(s.c.getState().status))
    await s.c.show(build(7))
    expect(s.c.getState()).toEqual({ status: 'loading', seq: 7 })
    s.tick(42)
    s.emit('firstFrame', undefined)
    expect(s.c.getState()).toEqual({ status: 'ready', seq: 7, ms: 42 })
    expect(s.reports).toEqual([{ seq: 7, ms: 42 }])
    expect(seen).toEqual(['loading', 'ready'])
  })

  it('a build without bytes shows its error and never touches the backend', async () => {
    const s = setup()
    await s.c.show(build(1, { bytes: undefined, error: 'FFDec build failed' }))
    expect(s.c.getState()).toEqual({ status: 'error', seq: 1, error: 'FFDec build failed' })
    expect(s.loads).toEqual([])
  })

  it('a rejected load becomes an error; a backend error event too', async () => {
    const s = setup(async () => {
      throw new Error('bad swf')
    })
    await s.c.show(build(1))
    expect(s.c.getState()).toMatchObject({ status: 'error', error: 'bad swf' })
    const s2 = setup()
    await s2.c.show(build(2))
    s2.emit('error', 'wasm failed')
    expect(s2.c.getState()).toMatchObject({ status: 'error', error: 'wasm failed' })
  })

  it('a first frame while idle is ignored (no report)', () => {
    const s = setup()
    s.emit('firstFrame', undefined)
    expect(s.reports).toEqual([])
    expect(s.c.getState().status).toBe('idle')
  })

  it('reload shows the last build again; a newer show supersedes a failing older load', async () => {
    const s = setup()
    await s.c.show(build(1))
    s.emit('firstFrame', undefined)
    await s.c.reload()
    expect(s.loads).toEqual([1, 1])
    expect(s.c.getState().status).toBe('loading')
    let reject!: (e: Error) => void
    const slow = setup(() => new Promise<void>((_, r) => (reject = r)))
    const first = slow.c.show(build(1))
    await slow.c.show(build(2, { bytes: undefined, error: 'newer' }))
    reject(new Error('older failed'))
    await first
    expect(slow.c.getState()).toMatchObject({ seq: 2, error: 'newer' })
  })

  it('dispose releases the backend and stops reacting', async () => {
    const s = setup()
    await s.c.show(build(1))
    s.c.dispose()
    s.emit('firstFrame', undefined)
    expect(s.isDisposed()).toBe(true)
    expect(s.reports).toEqual([])
  })
})
