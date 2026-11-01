import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MENU_VARIANT_ASPECTS } from '@inkwell-ui/spec'
import { variantBuildName } from '../../shared/menu'

/** Test-only: the per-screen-shape game SWFs the build writes next to `<name>.swf`. */
export const writeVariants = (buildDir: string, name: string, data: string): void => {
  for (const a of MENU_VARIANT_ASPECTS) writeFileSync(join(buildDir, variantBuildName(name, a)), data)
}
