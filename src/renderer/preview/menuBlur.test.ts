import { describe, expect, it } from 'vitest'
import { DIM, EDGE, CORE, OVERSCAN, SMEAR, edgeWeight } from './menuBlur'

describe('menuBlur', () => {
  it('weights the edge look from nothing in the centre to everything at the fade distance, without overshoot', () => {
    expect(edgeWeight(0)).toBe(0)
    expect(edgeWeight(1)).toBe(1)
    const w = Array.from({ length: 11 }, (_, i) => edgeWeight(i / 10))
    expect(w.every((v, i) => v >= 0 && v <= 1 && (i === 0 || v >= w[i - 1]!))).toBe(true)
  })

  it('keeps the fitted look: a stronger round blur in the middle than at the edges, a small smear, a slightly dimmed picture', () => {
    expect(CORE).toBeGreaterThan(EDGE)
    expect(SMEAR).toBeGreaterThan(0)
    expect(SMEAR).toBeLessThan(0.1)
    expect(DIM).toBeGreaterThan(0.5)
    expect(DIM).toBeLessThan(1)
    // the smear and the blur fade out at the borders: the overscan has to cover half the smear plus a few blur radii
    expect(OVERSCAN).toBeGreaterThan(SMEAR / 2 + 3 * CORE)
  })
})
