import { describe, expect, it } from 'vitest'
import { rectSvg } from './svg'

const stops = [{ position: 0, color: { r: 1, g: 0, b: 0 } }, { position: 1, color: { r: 0, g: 0, b: 1, a: 0.5 } }]

describe('gradient fills', () => {
  it('a linear gradient without a transform runs left to right over the box', () => {
    const svg = rectSvg(200, 100, { type: 'linear', stops }, 'n', [])!
    expect(svg).toContain('x1="0" y1="0" x2="1" y2="0"')
    expect(svg).toContain('gradientTransform="matrix(200 0 0 100 0 0)"')
    expect(svg).toContain('stop-color="#0000ff" stop-opacity="0.5"')
  })
  it("inverts Figma's gradientTransform (a top-to-bottom gradient)", () => {
    // Figma: [a, b, tx, c, d, ty] = [0, 1, 0, -1, 0, 1] maps the unit square so that gradient x = node y
    const svg = rectSvg(200, 100, { type: 'linear', stops, transform: [0, 1, 0, -1, 0, 1] }, 'n', [])!
    // gradient x = node y, so the gradient runs top to bottom
    expect(svg).toContain('gradientTransform="matrix(0 100 -200 0 200 0)"')
  })
  it('a radial gradient is centred in gradient space and a singular matrix falls back to the default', () => {
    const svg = rectSvg(10, 10, { type: 'radial', stops, transform: [0, 0, 0, 0, 0, 0] }, 'n', [])!
    expect(svg).toContain('<radialGradient id="g0" gradientUnits="userSpaceOnUse" cx="0.5" cy="0.5" r="0.5" gradientTransform="matrix(10 0 0 10 0 0)">')
  })
  it('a gradient without stops draws nothing', () => expect(rectSvg(10, 10, { type: 'linear', stops: [] }, 'n', [])).toBeUndefined())
})
