import { useState } from 'react'
import { strings } from '../../shared/strings'

/** One translation text field: edits stay local until Enter or blur; empty shows the missing marker. Used by the Localization table and the Inspector. */
export function TextCell({ value, title, onCommit }: { value: string; title: string; onCommit(v: string): void }) {
  const [draft, setDraft] = useState<string | undefined>()
  const commit = (): void => {
    if (draft !== undefined && draft !== value) onCommit(draft)
    setDraft(undefined)
  }
  return (
    <input
      value={draft ?? value}
      placeholder={strings.loc.missing}
      title={title}
      aria-label={title}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setDraft(undefined)
      }}
    />
  )
}
