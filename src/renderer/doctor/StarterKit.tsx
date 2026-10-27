import { strings } from '../strings'

const s = strings.starterKit
/** Everything the section shows, lowercased, for the Settings search. */
export const STARTER_TEXT = [s.title, s.intro, ...s.steps, 'figma starter kit text styles components themes'].join(' ').toLowerCase()

/** Settings section "Starter kit": what to build once in Figma (SPEC-CHANGES V8, docs/starter-kit.md). Text only; nothing runs. */
export function StarterKit() {
  return (
    <section data-testid="starter-kit">
      <h3>{s.title}</h3>
      <p className="dim">{s.intro}</p>
      <ol>{s.steps.map((t) => <li key={t}>{t}</li>)}</ol>
    </section>
  )
}
