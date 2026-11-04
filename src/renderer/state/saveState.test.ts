import { beforeEach, describe, expect, it } from 'vitest'
import { saveStateOf, setQueuedSaves, trackSave, useSaveStore, whenSaved } from './saveState'

describe('save state', () => {
  beforeEach(() => useSaveStore.setState({ queued: 0, inflight: 0 }))
  it('queued edits are unsaved, in-flight writes are saving, else saved', () => {
    expect(saveStateOf({ queued: 0, inflight: 0 })).toBe('saved')
    expect(saveStateOf({ queued: 0, inflight: 2 })).toBe('saving')
    expect(saveStateOf({ queued: 1, inflight: 2 })).toBe('unsaved')
  })
  it('tracks a promise until it settles, also when it rejects, and whenSaved waits for it', async () => {
    let fail!: (e: Error) => void
    trackSave(new Promise((_, rej) => (fail = rej)))
    expect(useSaveStore.getState().inflight).toBe(1)
    setQueuedSaves(1)
    let done = false
    const w = whenSaved().then(() => (done = true))
    setQueuedSaves(0)
    await Promise.resolve()
    expect(done).toBe(false)
    fail(new Error('x'))
    await w
    expect(useSaveStore.getState().inflight).toBe(0)
  })
})
