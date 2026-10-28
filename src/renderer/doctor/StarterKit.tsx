import { strings } from '../strings'
import { SettingItem } from '../ui/SettingItem'

const s = strings.starterKit
/** Everything the section shows, lowercased, for the Settings search. */
export const STARTER_TEXT = [s.title, s.intro, ...s.steps, 'figma starter kit text styles components themes'].join(' ').toLowerCase()

/** Settings row "Starter kit" (Figma category): what to build once in Figma (SPEC-CHANGES V8, docs/starter-kit.md). Text only; nothing runs. */
export function StarterKit() {
  return (
    <SettingItem name={s.title} value={s.value} testId="starter-kit">
      <p className="dim">{s.intro}</p>
      <ol>{s.steps.map((t) => <li key={t}>{t}</li>)}</ol>
    </SettingItem>
  )
}
