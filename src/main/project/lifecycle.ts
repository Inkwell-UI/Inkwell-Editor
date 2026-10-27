import { cp, mkdir, readdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { cleanModId } from '../../shared/modId'
import { loadProject, saveProject } from './index'

/** Folder must not exist or be empty: a project is never created on top of other files. */
async function assertEmpty(dir: string): Promise<void> {
  const entries = await readdir(dir).catch(() => [])
  if (entries.length) throw new Error(`"${dir}" is not empty. Choose an empty folder.`)
}

/** An empty project (no SWFs; they appear when the Figma plugin sends frames). The mod id is the folder name without anything but letters and digits. */
export async function createProject(dir: string, name = basename(dir)): Promise<void> {
  await assertEmpty(dir)
  await mkdir(dir, { recursive: true })
  await saveProject(dir, { meta: { name, modId: cleanModId(name), version: '0.1.0', deploy: { preset: 'folder', path: '' } }, swfs: {} })
  await writeFile(join(dir, '.gitignore'), PROJECT_GITIGNORE)
}

/** Build output and packages are derived and never committed (the samples carry the same file). */
export const PROJECT_GITIGNORE = 'build/\ndist/\n'

/** Copies a sample project (never its git-ignored `build/` output) into an empty folder and checks that the copy loads. */
export async function copyExample(src: string, dest: string): Promise<void> {
  await assertEmpty(dest)
  await mkdir(dest, { recursive: true })
  await cp(src, dest, { recursive: true, filter: (p) => !/[\\/]build([\\/]|$)/.test(p.slice(src.length)) })
  await loadProject(dest)
}

