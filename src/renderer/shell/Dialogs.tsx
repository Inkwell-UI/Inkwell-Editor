import { useEffect, useState } from 'react'
import { inkwell } from '../hooks/api'
import { useSyncState } from '../hooks/useSyncState'
import { useDialogStore } from '../state/dialogStore'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Dialog } from '../ui/Dialog'
import { MenuSettingsForm } from '../menu/MenuSettingsForm'
import { useActiveSwf } from '../hooks/useProject'

/** Approve-on-connect (protocol 4): the plugin's version, Figma file and origin. Escape or closing = Deny. */
function FigmaApproval() {
  const a = useSyncState()?.approval
  if (!a) return null
  const answer = (allow: boolean): void => void inkwell?.answerFigmaApproval(a.id, allow)
  const s = strings.approve
  return (
    <Dialog title={s.title} onClose={() => answer(false)}>
      <div data-testid="figma-approval">
        <p><strong>{s.question}</strong></p>
        <dl className="facts">
          <dt>{s.version}</dt><dd className="mono" data-testid="approval-version">{a.pluginVersion}</dd>
          <dt>{s.file}</dt><dd className="mono" data-testid="approval-file">{a.fileName}</dd>
          <dt>{s.origin}</dt><dd className="mono" data-testid="approval-origin">{a.origin}</dd>
        </dl>
        <p className="dim">{s.warn}</p>
        <div className="row-actions">
          <Btn variant="primary" onClick={() => answer(true)} testId="approval-allow">{s.allow}</Btn>
          <Btn onClick={() => answer(false)} testId="approval-deny">{s.deny}</Btn>
        </div>
      </div>
    </Dialog>
  )
}

type TargetKind = 'hudWidget' | 'customMenu' | 'menuReplacement'

/** The target of the active SWF: editor-side, Figma never sends one. A menu replacement also picks its contract and layers (IR `target.contract`, `target.layers`; W5). */
function TargetField() {
  const swf = useActiveSwf()
  const [err, setErr] = useState<string>()
  const [contracts, setContracts] = useState<{ menu: string; layers: string[] }[]>([])
  useEffect(() => void inkwell?.listContracts().then(setContracts), [])
  const t = strings.top.targetField
  if (!swf) return null
  const { kind, contract = '', layers = ['engine'] } = swf.ir.target
  const set = (k: TargetKind, more?: { contract?: string; layers?: string[] }): void =>
    void inkwell?.setSwfTarget(swf.name, k, more).then((r) => setErr(r.ok ? undefined : t.error(r.error)))
  const known = contracts.find((c) => c.menu === contract)?.layers ?? []
  // engine first, then the others in the Spec's order (CONTRACT_LAYERS), as the contract merge reads them
  const toggle = (l: string, on: boolean): void => set(kind, { layers: ['engine', 'skyui52', 'skyui6'].filter((x) => x === 'engine' || (x === l ? on : layers.includes(x))) })
  return (
    <div className="field">
      <label className="field-label" htmlFor="swf-target">{t.label}</label>
      <select id="swf-target" value={kind} data-testid="swf-target" onChange={(e) => set(e.target.value as TargetKind)}>
        <option value="hudWidget">{t.hudWidget}</option>
        <option value="customMenu">{t.customMenu}</option>
        <option value="menuReplacement">{t.menuReplacement}</option>
      </select>
      {kind === 'menuReplacement' && (
        <>
          <label className="field-label" htmlFor="swf-contract">{t.contract}</label>
          <select id="swf-contract" value={contract} data-testid="swf-contract" onChange={(e) => set(kind, { contract: e.target.value })}>
            <option value="">{t.contractNone}</option>
            {contracts.map((c) => <option key={c.menu} value={c.menu}>{c.menu}</option>)}
            {contract && !contracts.some((c) => c.menu === contract) && <option value={contract}>{contract}</option>}
          </select>
          {contract && (
            <fieldset data-testid="swf-layers">
              <legend className="field-label">{t.layers}</legend>
              {['engine', ...known.filter((l) => l !== 'engine' && l !== 'mod')].map((l) => (
                <label key={l} className="check">
                  <input type="checkbox" checked={l === 'engine' || layers.includes(l)} disabled={l === 'engine'} onChange={(e) => toggle(l, e.target.checked)} />
                  {t.layerNames[l] ?? l}
                </label>
              ))}
            </fieldset>
          )}
          <p className="dim">{t.layersHelp}</p>
        </>
      )}
      <p className="dim">{t.help}</p>
      {err && <p className="tone-error">{err}</p>}
    </div>
  )
}

function StubDialog() {
  const open = useDialogStore((s) => s.open)
  const close = useDialogStore((s) => s.close)
  const kind = useActiveSwf()?.ir.target.kind
  if (open === 'configOwnership' && kind === 'customMenu')
    return (
      <Dialog title={strings.dialogs.config.title} onClose={close} wide>
        <TargetField />
        <MenuSettingsForm />
      </Dialog>
    )
  if (open === 'configOwnership')
    return (
      <Dialog title={strings.dialogs.config.title} onClose={close}>
        <TargetField />
        <p>{strings.dialogs.config.body}</p>
        <div className="two-col">
          <section><h3>{strings.dialogs.config.author}</h3><p className="dim">{strings.dialogs.config.authorNote}</p></section>
          <section><h3>{strings.dialogs.config.user}</h3><p className="dim">{strings.dialogs.config.userNote}</p></section>
        </div>
      </Dialog>
    )
  if (open === 'figmaSetup')
    return (
      <Dialog title={strings.dialogs.figma.title} onClose={close}>
        <p>{strings.dialogs.figma.body}</p>
      </Dialog>
    )
  return null
}

/** Modal dialogs; only one stub dialog is open at a time (dialogStore). Config Ownership and the Figma guide are stubs. The Figma approval prompt comes from the sync state and can show over any of them. */
export function Dialogs() {
  return (
    <>
      <StubDialog />
      <FigmaApproval />
    </>
  )
}
