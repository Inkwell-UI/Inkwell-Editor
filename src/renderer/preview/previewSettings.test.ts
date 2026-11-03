import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREVIEW_SETTINGS, previewKey, usePreviewSettingsStore } from './previewSettings'

const KEY = 'inkwell.previewSettings.v2'
const mem = new Map<string, string>()
const a = previewKey('C:\\p', '1:2')
const b = previewKey('C:\\p', '1:3')

beforeEach(() => {
  mem.clear()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }
  })
  usePreviewSettingsStore.setState({ bySwf: {} })
})

describe('preview settings persistence', () => {
  it('defaults every overlay to off', () => {
    expect(Object.values(DEFAULT_PREVIEW_SETTINGS.overlays).some(Boolean)).toBe(false)
  })

  it('keeps one SWF apart from another and stores the image path, not its object URL (which dies with the session)', () => {
    usePreviewSettingsStore.getState().set(a, { ...DEFAULT_PREVIEW_SETTINGS, background: 'image', image: 'blob:x', imageName: 'a.png', imagePath: 'C:/img/a.png', imageMissing: true, color: '#112233' })
    const saved = JSON.parse(mem.get(KEY)!).state.bySwf
    expect(Object.keys(saved)).toEqual([a])
    expect(saved[a].color).toBe('#112233')
    expect(saved[a]).not.toHaveProperty('image')
    expect(saved[a]).not.toHaveProperty('imageMissing')
    expect(saved[a].imagePath).toBe('C:/img/a.png')
    expect(saved[a].imageName).toBe('a.png')
    expect(usePreviewSettingsStore.getState().bySwf[b]).toBeUndefined()
  })

  it('restores valid fields, drops garbage and falls an image background without a path back to none', async () => {
    mem.set(KEY, JSON.stringify({ state: { bySwf: { [a]: { overlays: { grid: true, safe: 'yes' }, marginPx: -5, background: 'image', color: 'red', brightness: 0.5 } } }, version: 0 }))
    await usePreviewSettingsStore.persist.rehydrate()
    const s = usePreviewSettingsStore.getState().bySwf[a]!
    expect(s.overlays.grid).toBe(true)
    expect(s.overlays.safe).toBe(DEFAULT_PREVIEW_SETTINGS.overlays.safe)
    expect(s.marginPx).toBe(DEFAULT_PREVIEW_SETTINGS.marginPx)
    expect(s.background).toBe('none')
    expect(s.color).toBe(DEFAULT_PREVIEW_SETTINGS.color)
    expect(s.brightness).toBe(0.5)
  })
})

describe('image background restore', () => {
  it('keeps an image background that has a path, to be read again when the SWF opens', async () => {
    mem.set(KEY, JSON.stringify({ state: { bySwf: { [a]: { background: 'image', imagePath: 'C:/img/a.png', imageName: 'a.png' } } }, version: 0 }))
    await usePreviewSettingsStore.persist.rehydrate()
    const s = usePreviewSettingsStore.getState().bySwf[a]!
    expect(s).toMatchObject({ background: 'image', imagePath: 'C:/img/a.png', imageName: 'a.png' })
    expect(s.image).toBeUndefined()
  })
})
