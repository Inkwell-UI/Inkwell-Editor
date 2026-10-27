import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ProjectMetaSchema, stableStringify } from './index'
import { exclusive } from './lock'

/** Sets one top-level key of project.json (unknown keys are kept; the result must still be a valid project.json). */
export function writeProjectSetting(projectDir: string, key: 'strictMode' | 'modId', value: boolean | string): Promise<void> {
  return exclusive(async () => {
    const file = join(projectDir, 'project.json')
    const meta = ProjectMetaSchema.parse({ ...JSON.parse(await readFile(file, 'utf8')), [key]: value })
    await writeFile(file, stableStringify(meta))
  })
}
