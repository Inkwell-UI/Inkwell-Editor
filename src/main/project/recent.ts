import { readFile, writeFile } from 'node:fs/promises'
import type { RecentProject } from '../../shared/projectState'

export const RECENT_KEEP = 10

const trim = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase() // Windows paths: case-insensitive
const same = (a: string, b: string): boolean => trim(a) === trim(b)

/** Newest first, one entry per folder, at most `keep`. */
export function addRecent(list: readonly RecentProject[], entry: RecentProject, keep = RECENT_KEEP): RecentProject[] {
  return [entry, ...list.filter((r) => !same(r.dir, entry.dir))].slice(0, keep)
}

/** Reads the list; a missing or damaged file is an empty list (it is only a convenience). Entries of the wrong shape are dropped. */
export async function loadRecent(file: string): Promise<RecentProject[]> {
  try {
    const raw: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (!Array.isArray(raw)) return []
    return raw.filter((r): r is RecentProject => !!r && typeof r.dir === 'string' && typeof r.name === 'string' && typeof r.openedAt === 'string').slice(0, RECENT_KEEP)
  } catch {
    return []
  }
}

export const saveRecent = (file: string, list: readonly RecentProject[]): Promise<void> => writeFile(file, JSON.stringify(list, null, 2) + '\n')
