import { readFile } from 'node:fs/promises'
import { writeAtomic } from './deploy/write'

export interface Rect { x: number; y: number; width: number; height: number }
export interface WindowState extends Rect { maximized: boolean }

const MIN_VISIBLE_W = 100 // of the window's width and
const MIN_VISIBLE_H = 50 // height that must lie on some display, so the title bar can be grabbed

/** The saved window state if it is well formed, at least `min` in size and still visible on one of the displays' work areas; otherwise undefined (the caller uses its defaults). */
export function validWindowState(raw: unknown, workAreas: readonly Rect[], min: { width: number; height: number }): WindowState | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const n = (k: string): number | undefined => (typeof r[k] === 'number' && Number.isFinite(r[k]) ? Math.round(r[k] as number) : undefined)
  const [x, y, width, height] = [n('x'), n('y'), n('width'), n('height')]
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined
  const w = Math.max(width, min.width)
  const h = Math.max(height, min.height)
  const visible = workAreas.some((a) => Math.min(x + w, a.x + a.width) - Math.max(x, a.x) >= MIN_VISIBLE_W && Math.min(y + h, a.y + a.height) - Math.max(y, a.y) >= MIN_VISIBLE_H)
  return visible ? { x, y, width: w, height: h, maximized: r['maximized'] === true } : undefined
}

export async function loadWindowState(file: string, workAreas: readonly Rect[], min: { width: number; height: number }): Promise<WindowState | undefined> {
  try {
    return validWindowState(JSON.parse(await readFile(file, 'utf8')), workAreas, min)
  } catch {
    return undefined
  }
}

export const saveWindowState = (file: string, s: WindowState): Promise<void> => writeAtomic(file, JSON.stringify(s)).catch(() => undefined)
