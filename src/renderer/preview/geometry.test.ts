import { describe, expect, it } from 'vitest'
import { ASPECTS } from '../../shared/preview'
import { fitStage, safeRects, screenBox, stepZoom, toStagePoint } from './geometry'

describe('fitStage (showAll letterbox)', () => {
  it('same aspect fills the box', () => {
    expect(fitStage({ width: 960, height: 540 }, { width: 1920, height: 1080 })).toEqual({ x: 0, y: 0, width: 960, height: 540, scale: 0.5 })
  })
  it('wider box: pillarbox bars left and right', () => {
    expect(fitStage({ width: 2100, height: 900 }, { width: 1600, height: 900 })).toEqual({ x: 250, y: 0, width: 1600, height: 900, scale: 1 })
  })
  it('taller box: letterbox bars top and bottom; upscales', () => {
    expect(fitStage({ width: 800, height: 800 }, { width: 400, height: 200 })).toEqual({ x: 0, y: 200, width: 800, height: 400, scale: 2 })
  })
  it('degenerate sizes give an empty rect', () => {
    expect(fitStage({ width: 0, height: 10 }, { width: 5, height: 5 }).scale).toBe(0)
    expect(fitStage({ width: 10, height: 10 }, { width: 0, height: 5 }).width).toBe(0)
  })
})

describe('screenBox', () => {
  it.each(Object.entries(ASPECTS))('%s fits the container with that ratio', (_id, ratio) => {
    const b = screenBox({ width: 1000, height: 600 }, ratio)
    expect(b.width / b.height).toBeCloseTo(ratio, 6)
    expect(b.width).toBeLessThanOrEqual(1000 + 1e-9)
    expect(b.height).toBeLessThanOrEqual(600 + 1e-9)
    expect(b.x * 2 + b.width).toBeCloseTo(1000, 6)
  })
})

describe('safeRects', () => {
  it('title-safe sits inside action-safe, both centred', () => {
    const { title, action } = safeRects({ width: 1000, height: 500 })
    expect(action.x).toBeCloseTo(35)
    expect(action.y).toBeCloseTo(17.5)
    expect(action.width).toBeCloseTo(930)
    expect(action.height).toBeCloseTo(465)
    expect(title.x).toBeCloseTo(50)
    expect(title.y).toBeCloseTo(25)
    expect(title.width).toBeCloseTo(900)
    expect(title.x).toBeGreaterThan(action.x)
    expect(title.x + title.width).toBeLessThan(action.x + action.width)
  })
})

describe('zoom and pointer mapping', () => {
  it('steps through the list and stays at the ends', () => {
    expect(stepZoom(1, 1)).toBe(1.25)
    expect(stepZoom(1, -1)).toBe(0.8)
    expect(stepZoom(0.5, -1)).toBe(0.5)
    expect(stepZoom(4, 1)).toBe(4)
    expect(stepZoom(0.9, 1)).toBe(1)
  })
  it('maps a pointer to stage coordinates through the fit rect, undefined in the letterbox', () => {
    const fit = fitStage({ width: 960, height: 600 }, { width: 1920, height: 1080 }) // scale 0.5, 960x540 at y=30
    expect(toStagePoint({ x: 100, y: 130 }, { x: 0, y: 0 }, fit)).toEqual({ x: 200, y: 200 })
    expect(toStagePoint({ x: 100, y: 10 }, { x: 0, y: 0 }, fit)).toBeUndefined()
    expect(toStagePoint({ x: 100, y: 130 }, { x: 0, y: 0 }, { ...fit, scale: 0 })).toBeUndefined()
  })
  it('4K keeps the 16:9 screen shape', () => {
    expect(ASPECTS['4K']).toBe(ASPECTS['16:9'])
  })
})
