import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { inkwell } from '../hooks/api'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Dialog } from '../ui/Dialog'

const s = strings.settings.figmaPlugins
/** Everything the section shows, lowercased, for the Settings search. */
export const FIGMA_PLUGINS_TEXT = `${s.title} ${s.none} ${s.forget} ${s.search}`.toLowerCase()

/** Settings section "Figma plugins": how many are approved and "Forget all Figma plugins" (after a confirmation). */
export function FigmaPlugins() {
  const [count, setCount] = useState<number>()
  const [confirm, setConfirm] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>()
  useEffect(() => void inkwell?.figmaPluginCount().then(setCount, () => undefined), [])
  const forget = (): void => {
    setConfirm(false)
    void inkwell?.forgetFigmaPlugins().then((r) => {
      setMsg(r.ok ? { ok: true, text: s.done } : { ok: false, text: s.failed(r.error) })
      if (r.ok) setCount(0)
    })
  }
  return (
    <section data-testid="figma-plugins" aria-labelledby="figma-plugins-title">
      <h3 id="figma-plugins-title">{s.title}</h3>
      {count !== undefined && <p className="dim" data-testid="figma-plugins-count">{count ? s.count(count) : s.none}</p>}
      {msg && <p className={msg.ok ? 'tone-ok' : 'tone-error'} role="status" data-testid="figma-plugins-msg">{msg.text}</p>}
      <div className="row-actions">
        <Btn icon={Trash2} haspopup="dialog" onClick={() => setConfirm(true)} reason={count === 0 ? s.none : undefined} testId="figma-forget">{s.forget}</Btn>
      </div>
      {confirm && (
        <Dialog title={s.confirmTitle} onClose={() => setConfirm(false)}>
          <div data-testid="figma-forget-confirm">
            <p>{s.confirmBody}</p>
            <div className="row-actions">
              <Btn variant="primary" onClick={forget} testId="figma-forget-yes">{s.confirmYes}</Btn>
              <Btn onClick={() => setConfirm(false)} testId="figma-forget-no">{s.cancel}</Btn>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  )
}
