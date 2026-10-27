import { useEffect, useId, useMemo, useState } from 'react'
import { CircleX, TriangleAlert } from 'lucide-react'
import { DEPTH_RANGE, HOTKEY_RANGE, INPUT_CONTEXTS, MenuSettings, OFFSET_X_RANGE, OFFSET_Y_RANGE, UI_SCALE_RANGE, effectiveInputContext, themeModes, type UserDefaults } from '@inkwell-ui/spec'
import { defaultMenuSettings, menuLint, minRuntimeOf, modIniPath, resolveMenuNames, type MenuSource } from '../../shared/menu'
import { SCAN_KEYS } from '../../shared/scanCodes'
import { inkwell } from '../hooks/api'
import { useActiveOverlay, useActiveSwf, useProject } from '../hooks/useProject'
import { hasFocusGraph } from '../../main/lint/focus'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'

const S = strings.menuCfg

/** A number that is committed on blur or Enter, only when it is valid; Escape puts the stored value back. */
function NumField({ label, value, min, max, step, int, onCommit, help, testId }: {
  label: string; value: number | undefined; min: number; max: number; step?: number; int?: boolean; onCommit(v: number | undefined): void; help?: string; testId: string
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
      <label className="field-label" htmlFor={id}>{label}</label>
      <input
        id={id} type="number" min={min} max={max} step={step ?? 1} value={text} className={err ? 'is-invalid' : undefined} aria-invalid={!!err} data-testid={testId}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setDraft(undefined) }}
      />
      {(err || help) && <p className={err ? 'tone-error' : 'dim'}>{err ?? help}</p>}
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
  useEffect(() => void setDoc(stored ?? defaultMenuSettings()), [swf?.id, stored])
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
  const ctx = effectiveInputContext(doc)
  const key = doc.triggers.hotkey
  const known = key !== undefined && SCAN_KEYS.some((k) => k.code === key)
  const u = doc.userDefaults ?? {}

  return (
    <div className="menu-form" data-testid="menu-settings">
      <h3 className="menu-form-head">{S.heading(swf.name)}</h3>
      {swf.menuError && <p className="tone-error" data-testid="menu-file-error">{S.fileError(swf.menuError)}</p>}
      <fieldset className="menu-cols" disabled={locked}>
        <section className="menu-col" aria-labelledby="menu-author">
          <h4 id="menu-author">{S.author}</h4>
          <p className="dim mono">{S.writesTo(`swfs/${swf.name}/menu.json`)}</p>
          <div className="field" role="group" aria-label={S.flags}>
            <span className="field-label">{S.flags}</span>
            <Check label={S.pausesGame} checked={doc.flags.pausesGame} onChange={flag('pausesGame')} testId="menu-pauses" />
            <Check label={S.cursor} checked={doc.flags.cursor} onChange={flag('cursor')} testId="menu-cursor" />
            <Check label={S.modal} checked={doc.flags.modal} onChange={flag('modal')} testId="menu-modal" />
            <Check label={S.closeOnEscape} checked={doc.flags.closeOnEscape} onChange={flag('closeOnEscape')} testId="menu-esc" />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="menu-context">{S.inputContext}</label>
            <select id="menu-context" value={ctx} onChange={(e) => edit((d) => ({ ...d, inputContext: e.target.value as (typeof INPUT_CONTEXTS)[number] }))} data-testid="menu-context">
              {INPUT_CONTEXTS.map((c) => <option key={c} value={c}>{S.inputContexts[c]}</option>)}
            </select>
          </div>
          <NumField label={S.depth} value={doc.depth} min={DEPTH_RANGE.min} max={DEPTH_RANGE.max} int onCommit={(v) => edit((d) => ({ ...d, depth: v ?? 3 }))} testId="menu-depth" />
          <div className="field" role="group" aria-label={S.triggers}>
            <span className="field-label">{S.triggers}</span>
            <Check label={S.papyrus(names.name)} checked={doc.triggers.papyrus} onChange={(v) => edit((d) => ({ ...d, triggers: { ...d.triggers, papyrus: v } }))} testId="menu-papyrus" />
            <Check label={S.modEvent} checked={doc.triggers.modEvent !== undefined} onChange={(v) => modEvent(v ? `${modId}_Open` : undefined)} testId="menu-event-on" />
            {doc.triggers.modEvent !== undefined && <ModEventField value={doc.triggers.modEvent} onCommit={modEvent} />}
          </div>
          <dl className="facts">
            <dt>{S.menuName}</dt><dd className="mono" data-testid="menu-name" title={S.menuNameHelp}>{names.name}</dd>
            <dt>{S.requires}</dt><dd data-testid="menu-requires" title={S.requiresHelp}>{minRuntimeOf(source)} <span className="dim">({S.requiresHelp})</span></dd>
          </dl>
        </section>

        <section className="menu-col" aria-labelledby="menu-user">
          <h4 id="menu-user">{S.user}</h4>
          <p className="dim mono">{S.writesTo(modIniPath(modId))}</p>
          <div className="field">
            <label className="field-label" htmlFor="menu-key">{S.openKey}</label>
            <div className="field-row">
              <select id="menu-key" value={key === undefined ? '' : known ? String(key) : 'other'} onChange={(e) => hotkey(e.target.value === '' ? undefined : e.target.value === 'other' ? (key ?? 37) : Number(e.target.value))} data-testid="menu-key">
                <option value="">{S.openKeyNone}</option>
                {SCAN_KEYS.map((k) => <option key={k.code} value={k.code}>{k.name} ({k.code})</option>)}
                {key !== undefined && !known && <option value="other">{key}</option>}
              </select>
              <input
                key={key ?? 'none'} type="number" min={HOTKEY_RANGE.min} max={HOTKEY_RANGE.max} defaultValue={key ?? ''} aria-label={S.openKeyCode} title={S.openKeyCode} data-testid="menu-key-code" className="menu-key-code"
                onBlur={(e) => { const n = Number(e.target.value); if (e.target.value.trim() === '') hotkey(undefined); else if (Number.isInteger(n) && n >= HOTKEY_RANGE.min && n <= HOTKEY_RANGE.max && n !== key) hotkey(n) }}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
            </div>
            <p className="dim">{S.openKeyHelp}</p>
          </div>
          <div className="field">
            <span className="field-label">{S.gamepad}</span>
            <Btn label={S.gamepad} reason={S.gamepadReason} testId="menu-gamepad">{S.gamepadReason}</Btn>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="menu-theme">{S.theme}</label>
            {themes.length >= 2 ? (
              <select id="menu-theme" value={u.theme ?? ''} onChange={(e) => user('theme', e.target.value)} data-testid="menu-theme">
                <option value="">{themes[0]}</option>
                {u.theme && !themes.includes(u.theme) && <option value={u.theme}>{S.themeUnknown(u.theme)}</option>}
                {themes.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <>
                <input id="menu-theme" key={u.theme ?? ''} defaultValue={u.theme ?? ''} spellCheck={false} data-testid="menu-theme" onBlur={(e) => e.target.value !== (u.theme ?? '') && user('theme', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
                <p className="dim">{S.themeNoCollection}</p>
              </>
            )}
            <p className="dim">{S.themeHelp}</p>
          </div>
          <NumField label={S.uiScale} value={u.uiScale} min={UI_SCALE_RANGE.min} max={UI_SCALE_RANGE.max} step={0.05} onCommit={(v) => user('uiScale', v)} help={S.uiScaleHelp} testId="menu-scale" />
          <div className="field-row">
            <NumField label={S.offsetX} value={u.offsetX} min={OFFSET_X_RANGE.min} max={OFFSET_X_RANGE.max} int onCommit={(v) => user('offsetX', v)} testId="menu-offset-x" />
            <NumField label={S.offsetY} value={u.offsetY} min={OFFSET_Y_RANGE.min} max={OFFSET_Y_RANGE.max} int onCommit={(v) => user('offsetY', v)} testId="menu-offset-y" />
          </div>
          <p className="dim">{S.offsetHelp}</p>
          <p className="dim">{S.devMode}</p>
        </section>
      </fieldset>
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

function ModEventField({ value, onCommit }: { value: string; onCommit(v: string): void }) {
  const [draft, setDraft] = useState<string | undefined>()
  const text = draft ?? value
  const err = !/^[A-Za-z0-9_]{1,64}$/.test(text)
  const commit = (): void => {
    if (draft !== undefined && !err && draft !== value) onCommit(draft)
    setDraft(undefined)
  }
  return (
    <div className="field">
      <input value={text} aria-label={S.modEventName} aria-invalid={err} className={err ? 'is-invalid' : undefined} spellCheck={false} data-testid="menu-event" onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setDraft(undefined) }} />
      <p className={err ? 'tone-error' : 'dim'}>{S.modEventHelp}</p>
    </div>
  )
}
