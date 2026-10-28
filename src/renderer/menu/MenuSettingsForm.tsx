import { useEffect, useId, useMemo, useState } from 'react'
import { Check as Check2, CircleX, Copy, TriangleAlert } from 'lucide-react'
import { DEPTH_RANGE, HOTKEY_RANGE, INPUT_CONTEXTS, MENU_NAME, MenuSettings, OFFSET_X_RANGE, OFFSET_Y_RANGE, SYSTEM_MENU_LABEL, UI_SCALE_RANGE, effectiveInputContext, themeModes, type UserDefaults } from '@inkwell-ui/spec'
import { defaultMenuSettings, menuLint, minRuntimeOf, modIniPath, resolveMenuNames, type MenuSource } from '../../shared/menu'
import { SCAN_KEYS } from '../../shared/scanCodes'
import { inkwell } from '../hooks/api'
import { useActiveOverlay, useActiveSwf, useProject } from '../hooks/useProject'
import { hasFocusGraph } from '../../main/lint/focus'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Fold } from '../ui/Fold'

const S = strings.menuCfg

/** A number that is committed on blur or Enter, only when it is valid; Escape puts the stored value back. */
function NumField({ label, value, min, max, step, int, onCommit, help, placeholder, testId }: {
  label: string; value: number | undefined; min: number; max: number; step?: number; int?: boolean; onCommit(v: number | undefined): void; help?: string; placeholder?: string; testId: string
}) {
  const id = useId()
  const [draft, setDraft] = useState<string | undefined>()
  const text = draft ?? (value === undefined ? '' : String(value))
  const n = Number(text)
  const err = draft !== undefined && draft.trim() !== '' && !(Number.isFinite(n) && n >= min && n <= max && (!int || Number.isInteger(n))) ? `${min} to ${max}${int ? ', whole number' : ''}` : undefined
  const commit = (): void => {
    if (draft === undefined || err) return // an invalid draft stays on screen with its message until it is fixed or Escape puts the stored value back
    if (draft.trim() === '') onCommit(undefined)
    else if (n !== value) onCommit(n)
    setDraft(undefined)
  }
  return (
    <div className="field">
      <div className="menu-label-row"><label className="field-label" htmlFor={id}>{label}</label></div>
      <input
        id={id} type="number" min={min} max={max} step={step ?? 1} value={text} placeholder={placeholder} title={help} className={err ? 'is-invalid' : undefined} aria-invalid={!!err} data-testid={testId}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setDraft(undefined) }}
      />
      {err && <p className="tone-error">{err}</p>}
    </div>
  )
}

function Check({ label, checked, onChange, testId, disabled }: { label: string; checked: boolean; onChange(v: boolean): void; testId: string; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testId} /> {label}
    </label>
  )
}

/**
 * The Config Ownership form (UX 5.1, SPEC-CHANGES S9) for the active custom menu: the author column writes `swfs/<name>/menu.json` flags and triggers, the end-user column
 * writes `userDefaults` and the default `<modId>.ini` text. Every edit is validated against the Spec schema and saved at once (IPC `saveMenuSettings`); an invalid value is
 * shown and not saved. Used by the Menu panel and by the Target pill's dialog.
 */
export function MenuSettingsForm() {
  const swf = useActiveSwf()
  const project = useProject()
  const stored = swf?.menu
  const [doc, setDoc] = useState<MenuSettings>(stored ?? defaultMenuSettings())
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>()
  const [otherKey, setOtherKey] = useState(false) // "Other code…" chosen: the scan code field shows until a listed key is picked
  useEffect(() => void setDoc(stored ?? defaultMenuSettings()), [swf?.id, stored])
  useEffect(() => setOtherKey(false), [swf?.id])
  const modId = project?.modId ?? ''

  const source: MenuSource | undefined = swf ? { swf: swf.name, settings: doc } : undefined
  const names = source ? resolveMenuNames(modId, source) : undefined
  const focus = hasFocusGraph(useActiveOverlay()?.nodes ?? {})
  const rows = useMemo(() => {
    if (!project || !swf) return []
    const all: MenuSource[] = project.swfs.filter((s) => !s.orphaned && s.ir.target.kind === 'customMenu').map((s) => (s.id === swf.id ? { swf: s.name, settings: doc, ...(focus ? { features: ['focusGraph'] } : {}) } : { swf: s.name, settings: s.menu ?? defaultMenuSettings() }))
    return menuLint(project.modId, all).filter((r) => !r.swf || r.swf === swf.name)
  }, [project, swf, doc, focus])

  if (!swf || !source || !names) return <p className="empty">{S.noSwf}</p>
  const kind = swf.ir.target.kind
  if (kind !== 'customMenu') return <p className="empty" data-testid="menu-not-custom"><strong>{S.notMenu}</strong><br />{S.notMenuBody(kind)}</p>
  const locked = swf.menuError !== undefined
  const themes = themeModes(swf.ir)

  const edit = (f: (d: MenuSettings) => MenuSettings): void => {
    const p = MenuSettings.safeParse(f(doc))
    if (!p.success) return setMsg({ ok: false, text: S.invalid(p.error.issues[0]?.message ?? 'invalid') })
    setDoc(p.data)
    setMsg(undefined)
    void inkwell?.saveMenuSettings(swf.name, p.data).then((r) => setMsg(r.ok ? { ok: true, text: S.saved } : { ok: false, text: S.saveError(r.error) }))
  }
  const flag = (k: 'pausesGame' | 'cursor' | 'modal' | 'closeOnEscape') => (v: boolean) => edit((d) => ({ ...d, flags: { ...d.flags, [k]: v } }))
  const user = (k: keyof UserDefaults, v: number | string | undefined) =>
    edit((d) => {
      const u: Record<string, unknown> = { ...d.userDefaults }
      if (v === undefined || v === '') delete u[k]
      else u[k] = v
      const { userDefaults: _old, ...rest } = d
      return (Object.keys(u).length ? { ...rest, userDefaults: u } : rest) as MenuSettings
    })
  const hotkey = (v: number | undefined) =>
    edit((d) => {
      const t: Record<string, unknown> = { ...d.triggers }
      if (v === undefined) delete t['hotkey']
      else t['hotkey'] = v
      return { ...d, triggers: t } as MenuSettings
    })
  const modEvent = (v: string | undefined) =>
    edit((d) => {
      const t: Record<string, unknown> = { ...d.triggers }
      if (v === undefined) delete t['modEvent']
      else t['modEvent'] = v
      return { ...d, triggers: t } as MenuSettings
    })
  const systemMenu = (v: string | undefined) =>
    edit((d) => {
      const t: Record<string, unknown> = { ...d.triggers }
      if (v === undefined) delete t['systemMenu']
      else t['systemMenu'] = v
      return { ...d, triggers: t } as MenuSettings
    })
  const ctx = effectiveInputContext(doc)
  const key = doc.triggers.hotkey
  const known = key !== undefined && SCAN_KEYS.some((k) => k.code === key)
  const u = doc.userDefaults ?? {}
  const showCode = otherKey || (key !== undefined && !known)
  const pickKey = (v: string): void => {
    setOtherKey(v === 'other')
    if (v !== 'other') hotkey(v === '' ? undefined : Number(v))
  }

  return (
    <div className="menu-form" data-testid="menu-settings">
      <h3 className="menu-form-head">{S.heading(swf.name)}</h3>
      {swf.menuError && <p className="tone-error" data-testid="menu-file-error">{S.fileError(swf.menuError)}</p>}
      <fieldset className="menu-cols" disabled={locked}>
        <div className="menu-col">
          <section className="menu-group" aria-labelledby="menu-opens">
            <h4 id="menu-opens">{S.opensWith}</h4>
            <div className="menu-line">
              <div className="menu-label-row"><label className="field-label" htmlFor="menu-key">{S.openKey}</label></div>
              <div className="menu-line-ctl">
                <select id="menu-key" title={S.openKeyHelp} value={showCode ? 'other' : key === undefined ? '' : String(key)} onChange={(e) => pickKey(e.target.value)} data-testid="menu-key">
                  <option value="">{S.openKeyNone}</option>
                  {SCAN_KEYS.map((k) => <option key={k.code} value={k.code}>{k.name}</option>)}
                  <option value="other">{S.openKeyOther}</option>
                </select>
                {showCode && (
                  <input
                    key={key ?? 'none'} type="number" min={HOTKEY_RANGE.min} max={HOTKEY_RANGE.max} defaultValue={key ?? ''} aria-label={S.openKeyCode} title={S.openKeyCode} data-testid="menu-key-code" className="menu-key-code"
                    onBlur={(e) => { const n = Number(e.target.value); if (e.target.value.trim() === '') hotkey(undefined); else if (Number.isInteger(n) && n >= HOTKEY_RANGE.min && n <= HOTKEY_RANGE.max && n !== key) hotkey(n) }}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  />
                )}
              </div>
            </div>
            <div className="menu-line">
              <span className="field-label">{S.gamepad}</span>
              <div className="menu-line-ctl"><Btn label={S.gamepad} reason={S.gamepadReason} testId="menu-gamepad">{S.gamepadReason}</Btn></div>
            </div>
            <hr className="menu-rule" />
            <div className="menu-line">
              <div className="menu-label-row"><Check label={S.papyrus} checked={doc.triggers.papyrus} onChange={(v) => edit((d) => ({ ...d, triggers: { ...d.triggers, papyrus: v } }))} testId="menu-papyrus" /></div>
              <div className="menu-line-ctl">
                {doc.triggers.papyrus && (
                  <div className="menu-copyable">
                    <MenuNameField value={names.name} onCommit={(v) => edit((d) => { const { name: _old, ...rest } = d; return (v === `${modId}_${names.file}` ? rest : { ...rest, name: v }) as MenuSettings })} />
                    <CopyBtn text={S.papyrusHelp(names.name)} label={S.papyrusCopy} testId="menu-papyrus-copy" />
                  </div>
                )}
              </div>
            </div>
            <div className="menu-line">
              <div className="menu-label-row"><Check label={S.modEvent} checked={doc.triggers.modEvent !== undefined} onChange={(v) => modEvent(v ? `${modId}_Open` : undefined)} testId="menu-event-on" /></div>
              <div className="menu-line-ctl">
                {doc.triggers.modEvent !== undefined && (
                  <div className="menu-copyable">
                    <ModEventField value={doc.triggers.modEvent} onCommit={modEvent} />
                    <CopyBtn text={doc.triggers.modEvent} label={S.modEventCopy} testId="menu-event-copy" />
                  </div>
                )}
              </div>
            </div>
            <div className="menu-line">
              <div className="menu-label-row"><Check label={S.systemMenu} checked={doc.triggers.systemMenu !== undefined} onChange={(v) => systemMenu(v ? `$${names.name}` : undefined)} testId="menu-system-on" /></div>
              <div className="menu-line-ctl">{doc.triggers.systemMenu !== undefined && <SystemMenuField value={doc.triggers.systemMenu} onCommit={systemMenu} />}</div>
            </div>
          </section>
        </div>

        <div className="menu-col">
          <section className="menu-group" aria-labelledby="menu-while">
            <h4 id="menu-while">{S.whileOpen}</h4>
            <div className="menu-pair">
              <Check label={S.pausesGame} checked={doc.flags.pausesGame} onChange={flag('pausesGame')} testId="menu-pauses" />
              <Check label={S.cursor} checked={doc.flags.cursor} onChange={flag('cursor')} testId="menu-cursor" />
              <Check label={S.modal} checked={doc.flags.modal} onChange={flag('modal')} testId="menu-modal" />
              <Check label={S.closeOnEscape} checked={doc.flags.closeOnEscape} onChange={flag('closeOnEscape')} testId="menu-esc" />
            </div>
            <Fold id="menu-advanced" title={S.advanced} summary={S.advancedSummary(S.inputContexts[ctx] ?? ctx, doc.depth)}>
              <div className="menu-pair">
                <div className="field">
                  <label className="field-label" htmlFor="menu-context">{S.inputContext}</label>
                  <select id="menu-context" value={ctx} onChange={(e) => edit((d) => ({ ...d, inputContext: e.target.value as (typeof INPUT_CONTEXTS)[number] }))} data-testid="menu-context">
                    {INPUT_CONTEXTS.map((c) => <option key={c} value={c}>{S.inputContexts[c]}</option>)}
                  </select>
                </div>
                <NumField label={S.depth} value={doc.depth} min={DEPTH_RANGE.min} max={DEPTH_RANGE.max} int onCommit={(v) => edit((d) => ({ ...d, depth: v ?? 3 }))} testId="menu-depth" />
              </div>
            </Fold>
          </section>

          <section className="menu-group" aria-labelledby="menu-screen">
            <h4 id="menu-screen" title={S.writesTo(modIniPath(modId))}>{S.onScreen}<span className="menu-group-note">{S.playerCanChange}</span></h4>
            <div className="menu-trio">
              <NumField label={S.uiScale} value={u.uiScale} min={UI_SCALE_RANGE.min} max={UI_SCALE_RANGE.max} step={0.05} onCommit={(v) => user('uiScale', v)} help={S.uiScaleHelp} placeholder="1" testId="menu-scale" />
              <NumField label={S.offsetX} value={u.offsetX} min={OFFSET_X_RANGE.min} max={OFFSET_X_RANGE.max} int onCommit={(v) => user('offsetX', v)} help={S.offsetHelp} placeholder="0" testId="menu-offset-x" />
              <NumField label={S.offsetY} value={u.offsetY} min={OFFSET_Y_RANGE.min} max={OFFSET_Y_RANGE.max} int onCommit={(v) => user('offsetY', v)} help={S.offsetHelp} placeholder="0" testId="menu-offset-y" />
            </div>
            {(themes.length >= 2 || u.theme) && (
              <div className="field">
                <div className="menu-label-row"><label className="field-label" htmlFor="menu-theme" title={S.themeHelp}>{S.theme}</label></div>
                {themes.length >= 2 ? (
                  <select id="menu-theme" value={u.theme ?? ''} onChange={(e) => user('theme', e.target.value)} data-testid="menu-theme">
                    <option value="">{themes[0]}</option>
                    {u.theme && !themes.includes(u.theme) && <option value={u.theme}>{S.themeUnknown(u.theme)}</option>}
                    {themes.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                ) : (
                  <input id="menu-theme" key={u.theme ?? ''} defaultValue={u.theme ?? ''} spellCheck={false} data-testid="menu-theme" onBlur={(e) => e.target.value !== (u.theme ?? '') && user('theme', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
                )}
              </div>
            )}
          </section>
        </div>
      </fieldset>
      <div className="menu-foot">
        {/* with the Papyrus call on, the menu name is its editable field */}
        {!doc.triggers.papyrus && <span>{S.menuName} <b className="mono" data-testid="menu-name" title={S.menuNameHelp}>{names.name}</b></span>}
        <span className="menu-foot-end">{S.requires} <b data-testid="menu-requires" title={S.requiresHelp}>{minRuntimeOf(source)}</b></span>
      </div>
      {msg && <p className={msg.ok ? 'dim' : 'tone-error'} role="status" data-testid="menu-status">{msg.text}</p>}
      {rows.length > 0 && (
        <section aria-labelledby="menu-issues">
          <h4 id="menu-issues">{S.issues}</h4>
          <ul className="plain" data-testid="menu-issues">
            {rows.map((r, i) => (
              <li key={i} className={`issue ${r.severity === 'error' ? 'tone-error' : 'tone-warn'}`}>
                {r.severity === 'error' ? <CircleX size={14} aria-hidden="true" /> : <TriangleAlert size={14} aria-hidden="true" />} <span className="mono">{r.code}</span> <span>{r.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/** The menu name: the engine name and the Papyrus call's argument. Saved only when valid; the default name is stored as no name at all. */
function MenuNameField({ value, onCommit }: { value: string; onCommit(v: string): void }) {
  const [draft, setDraft] = useState<string | undefined>()
  const text = draft ?? value
  const err = !MENU_NAME.test(text)
  const commit = (): void => {
    if (draft !== undefined && !err && draft !== value) onCommit(draft)
    setDraft(undefined)
  }
  return (
    <div className="menu-stack">
      <input value={text} aria-label={S.menuName} title={S.menuNameHelp} aria-invalid={err} className={err ? 'is-invalid mono' : 'mono'} spellCheck={false} data-testid="menu-name" onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setDraft(undefined) }} />
      {err && <p className="tone-error">{S.menuNameInvalid}</p>}
    </div>
  )
}

/** Appears at the right of its row on hover or keyboard focus; the space is always reserved so the field does not jump. */
function CopyBtn({ text, label, testId }: { text: string; label: string; testId: string }) {
  const [done, setDone] = useState(false)
  return (
    <Btn
      icon={done ? Check2 : Copy} variant="quiet" className="menu-copy" label={done ? S.copied : label} testId={testId}
      onClick={() => { void navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) }}
    />
  )
}

function ModEventField({ value, onCommit }: { value: string; onCommit(v: string): void }) {
  const [draft, setDraft] = useState<string | undefined>()
  const text = draft ?? value
  const err = !/^[A-Za-z0-9_]{1,64}$/.test(text)
  const commit = (): void => {
    if (draft !== undefined && !err && draft !== value) onCommit(draft)
    setDraft(undefined)
  }
  return (
    <div className="menu-stack">
      <input value={text} aria-label={S.modEventName} aria-invalid={err} className={err ? 'is-invalid' : undefined} spellCheck={false} data-testid="menu-event" onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setDraft(undefined) }} />
      {err && <p className="tone-error">{S.modEventHelp}</p>}
    </div>
  )
}

function SystemMenuField({ value, onCommit }: { value: string; onCommit(v: string): void }) {
  const [draft, setDraft] = useState<string | undefined>()
  const text = draft ?? value
  const err = text.length < SYSTEM_MENU_LABEL.min || text.length > SYSTEM_MENU_LABEL.max
  const commit = (): void => {
    if (draft !== undefined && !err && draft !== value) onCommit(draft)
    setDraft(undefined)
  }
  return (
    <div className="menu-stack">
      <input value={text} aria-label={S.systemMenuLabel} aria-invalid={err} className={err ? 'is-invalid' : undefined} spellCheck={false} data-testid="menu-system-label" onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setDraft(undefined) }} />
      {err && <p className="tone-error">{S.systemMenuHelp}</p>}
    </div>
  )
}
