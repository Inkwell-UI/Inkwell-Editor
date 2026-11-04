import { stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

/** A path the renderer says was dropped on the window, trusted for nothing: the resolved folder only if it is an existing directory that holds project.json, else undefined. */
export async function droppedProjectDir(raw: unknown): Promise<string | undefined> {
  if (typeof raw !== 'string' || !raw || /[\0\r\n]/.test(raw) || !isAbsolute(raw)) return undefined
  const dir = resolve(raw)
  try {
    if (!(await stat(dir)).isDirectory()) return undefined
    return (await stat(join(dir, 'project.json'))).isFile() ? dir : undefined
  } catch {
    return undefined
  }
}
