import { useState } from 'react'
import { devTone, type DevPhase, type DevState } from '../../shared/devLink'
import { inkwell } from '../hooks/api'
import { useDevStore } from '../state/devStore'
import { hotReload } from '../state/hotReload'
import { strings } from '../../shared/strings'
import { Btn } from '../ui/Btn'
import { Fold } from '../ui/Fold'
import { Popover } from '../ui/Popover'

/** The status text of the dot and the popover head (pure: the tests and the screenshot driver read it). */
export function gameLabel(d: Pick<DevState, 'phase' | 'specMismatch'>): string {
  return d.phase === 'connected' && d.specMismatch ? strings.dev.specMismatch : (strings.dev.phase[d.phase] ?? d.phase)
}

/** The short chip text of the popover (the dot's tooltip keeps the long `gameLabel`). */
export const gameChip = (d: Pick<DevState, 'phase' | 'specMismatch'>): string =>
  d.phase === 'connected' && d.specMismatch ? strings.dev.chipSpecMismatch : (strings.dev.chip[d.phase] ?? d.phase)

/** Phases where the editor is not trying: the one button says Connect. In the others it is connected or retrying, and the button says Disconnect. */
const IDLE: DevPhase[] = ['off', 'noToken', 'unauthorized', 'protocolMismatch', 'refused']

export function GameDetails() {
  const dev = useDevStore((s) => s.dev)
  const [token, setToken] = useState('')
  const [port, setPort] = useState(String(dev.port))
  const [problem, setProblem] = useState<string>()
  const t = strings.dev
  const connected = dev.phase === 'connected'
  const idle = IDLE.includes(dev.phase)
  const useToken = async (v: string | null): Promise<void> => {
    const r = await inkwell?.devSetToken(v)
    setProblem(r && !r.ok ? r.error : undefined)
    if (r?.ok) setToken('')
  }
  const applyPort = async (): Promise<void> => {
    const r = await inkwell?.devSetPort(Number(port))
    setProblem(r && !r.ok ? r.error : undefined)
  }
  const tone = devTone(dev)
  const hint = dev.phase === 'noToken' ? { head: t.noTokenHelp } : dev.phase === 'waiting' ? { head: t.waitingHint, more: t.waitingHintMore } : undefined
  const tokenTip = `${t.tokenSources[dev.tokenSource]}${dev.tokenFrom ? `: ${dev.tokenFrom}` : ''}`
  return (
    <div className="details conn" data-testid="game-details">
      <div className="conn-head">
        <span className={`dot dot-${tone}`} aria-hidden="true" />
        <strong>{strings.top.game}</strong>
        <span className="conn-status" data-testid="game-status" title={gameLabel(dev)}>{gameChip(dev)}</span>
      </div>
      {dev.message && <p className={tone === 'error' ? 'tone-error' : 'tone-warn'} data-testid="game-message">{dev.message}</p>}
      <dl className="conn-facts">
        {connected && dev.runtime && (
          <>
            <dt>{t.runtime}</dt><dd data-testid="game-runtime">{dev.runtime.versionString}</dd>
            <dt>{t.game}</dt><dd>{dev.runtime.gameVersion}</dd>
            {dev.specMismatch && <><dt>{t.protocol}</dt><dd>{dev.runtime.protocol}</dd><dt>{t.spec}</dt><dd>{dev.runtime.spec}</dd></>}
          </>
        )}
        <dt>{t.port}</dt><dd className="mono">127.0.0.1:{dev.port}</dd>
        <dt>{t.token}</dt>
        <dd data-testid="game-token" title={tokenTip}>
          {dev.tokenMasked ? <span className="mono">{dev.tokenMasked}</span> : t.tokenNotSet}
          {dev.tokenSource === 'pasted' && <> <span className="dim">{t.tokenPastedNote}</span></>}
        </dd>
        <dt>{t.devDeployRow}</dt><dd title={dev.devDeploy ? t.devDeployOn : t.devDeployOff}>{dev.devDeploy ? t.on : t.off}</dd>
        {connected && (
          <>
            <dt>{t.menusRow}</dt>
            <dd data-testid="game-menus">
              {dev.menus.length === 0 ? <span className="dim">{t.noMenus}</span> : (
                <div className="conn-menus">
                  {dev.menus.map((m) => (
                    <div className="conn-menu" key={m.name}>
                      <span className={`dot dot-${m.open ? 'ok' : 'off'}`} aria-hidden="true" />
                      <span className="mono">{m.name}</span>
                      <span className="conn-menu-state">{m.open ? t.menuOpen : t.menuClosed}</span>
                    </div>
                  ))}
                </div>
              )}
            </dd>
          </>
        )}
      </dl>
      {hint && <p className="conn-hint"><strong>{hint.head}</strong>{hint.more ? ` ${hint.more}` : ''}</p>}
      <Fold id="game-token-port" title={t.settingsFold} summary={`${dev.tokenMasked ?? t.tokenNotSet} · ${dev.port}`} defaultOpen={dev.phase === 'noToken' || dev.phase === 'unauthorized'}>
        <span className="conn-lbl" title={t.pasteTip}>{t.pasteLabel}</span>
        <div className="conn-field-row">
          <input type="password" autoComplete="off" spellCheck={false} className="gn-input mono" placeholder={t.pastePlaceholder} value={token} onChange={(e) => setToken(e.target.value)} aria-label={t.pasteTitle} data-testid="game-token-input" />
          <Btn onClick={() => void useToken(token)} reason={token.trim() ? undefined : t.pastePlaceholder} testId="game-token-use">{t.pasteUse}</Btn>
        </div>
        {dev.tokenSource === 'pasted' && <div className="conn-field-row"><Btn onClick={() => void useToken(null)} testId="game-token-forget">{t.pasteClear}</Btn></div>}
        <span className="conn-lbl">{t.portFieldLabel}</span>
        <div className="conn-field-row">
          <input type="number" min={1024} max={65535} className="gn-input mono port-input" value={port} onChange={(e) => setPort(e.target.value)} aria-label={t.portFieldLabel} data-testid="game-port-input" />
          <Btn onClick={() => void applyPort()} testId="game-port-set">{t.portSet}</Btn>
        </div>
        {problem && <p className="tone-error" role="alert" data-testid="game-problem">{problem}</p>}
      </Fold>
      <div className="conn-actions">
        {idle
          ? <Btn variant="primary" onClick={() => void inkwell?.devConnect()} testId="game-connect">{t.connect}</Btn>
          : <Btn onClick={() => void inkwell?.devDisconnect()} testId="game-disconnect">{t.disconnect}</Btn>}
        <Btn onClick={() => void hotReload()} reason={connected || dev.devDeploy ? undefined : t.reloadNeedsGame} testId="game-reload">{t.hotReload}</Btn>
      </div>
    </div>
  )
}

/** Zone 6B Game dot (UX 4.6): grey off or waiting, amber connecting / busy / version difference, green connected in Dev Mode, red refused (wrong token, protocol). */
export function GameDot() {
  const dev = useDevStore((s) => s.dev)
  const tone = devTone(dev)
  const label = gameLabel(dev)
  const tip = `${strings.top.game}: ${label}${dev.phase === 'connected' && dev.runtime ? ` (${strings.dev.connectedTip(dev.runtime.versionString, dev.port)})` : ''}`
  return (
    <Popover
      label={strings.top.gameDetails}
      align="end"
      up
      trigger={(p) => (
        <button type="button" className="item item-fixed item-button" {...p} title={tip} aria-label={tip} data-testid="dot-game" data-tone={tone} data-phase={dev.phase}>
          <span className={`dot dot-${tone}`} aria-hidden="true" /> {strings.top.game}
        </button>
      )}
    >
      <GameDetails />
    </Popover>
  )
}
