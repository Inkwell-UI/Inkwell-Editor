import { describe, expect, it } from 'vitest'
import { validWindowState } from './windowState'

const min = { width: 960, height: 600 }
const screen = [{ x: 0, y: 0, width: 1920, height: 1080 }]
const second = [...screen, { x: 1920, y: 0, width: 1280, height: 1024 }]

describe('validWindowState', () => {
  it('keeps bounds that are on a display, with the maximized flag', () => {
    expect(validWindowState({ x: 100, y: 50, width: 1200, height: 800, maximized: true }, screen, min)).toEqual({ x: 100, y: 50, width: 1200, height: 800, maximized: true })
  })
  it('drops bounds on a display that is gone, and bounds with too little on screen', () => {
    const s = { x: 2000, y: 100, width: 1200, height: 800 }
    expect(validWindowState(s, screen, min)).toBeUndefined()
    expect(validWindowState(s, second, min)).toMatchObject(s)
    expect(validWindowState({ x: 1850, y: 100, width: 1200, height: 800 }, screen, min)).toBeUndefined() // 70 px visible
    expect(validWindowState({ x: 0, y: 1060, width: 1200, height: 800 }, screen, min)).toBeUndefined() // title bar below the work area
  })
  it('refuses junk and raises a too-small size to the minimum', () => {
    expect(validWindowState(null, screen, min)).toBeUndefined()
    expect(validWindowState({ x: '1', y: 0, width: 1000, height: 700 }, screen, min)).toBeUndefined()
    expect(validWindowState({ x: 0, y: 0, width: NaN, height: 700 }, screen, min)).toBeUndefined()
    expect(validWindowState({ x: 0, y: 0, width: 100, height: 100 }, screen, min)).toMatchObject({ width: 960, height: 600, maximized: false })
  })
})
