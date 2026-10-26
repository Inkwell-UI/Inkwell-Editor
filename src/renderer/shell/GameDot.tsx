import { useState } from 'react'
import { devTone, type DevState } from '../../shared/devLink'
import { inkwell } from '../hooks/api'
import { useDevStore } from '../state/devStore'
import { hotReload } from '../state/hotReload'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Popover } from '../ui/Popover'

/** The status text of the dot and the popover head (pure: the tests and the screenshot driver read it). */
export function gameLabel(d: Pick<DevState, 'phase' | 'specMismatch'>): string {
  return d.phase === 'connected' && d.specMismatch ? strings.dev.specMismatch : (strings.dev.phase[d.phase] ?? d.phase)
}

export function GameDetails() {
  const dev = useDevStore((s) => s.dev)
  const [token, setToken] = useState('')
  const [port, setPort] = useState(String(dev.port))
  const [problem, setProblem] = useState<string>()
  const connected = dev.phase === 'connected'
  const useToken = async (t: string | null): Promise<void> => {
    const r = await inkwell?.devSetToken(t)
    setProblem(r && !r.ok ? r.error : undefined)
    if (r?.ok) setToken('')
  }
  const applyPort = async (): Promise<void> => {
    const r = await inkwell?.devSetPort(Number(port))
    setProblem(r && !r.ok ? r.error : undefined)
  }
  return (
    <div className="details game-details" data-testid="game-details">
      <h3>{strings.dev.detailsTitle}</h3>
      <p><strong data-testid="game-status">{gameLabel(dev)}</strong></p>
      {dev.message && <p className={devTone(dev) === 'error' ? 'tone-error' : 'tone-warn'} data-testid="game-message">{dev.message}</p>}
      <dl className="facts">
        {connected && dev.runtime && (
          <>
            <dt>{strings.dev.runtime}</dt><dd className="mono" data-testid="game-runtime">{dev.runtime.versionString}</dd>
            <dt>{strings.dev.game}</dt><dd className="mono">{dev.runtime.gameVersion}</dd>
            <dt>{strings.dev.protocol}</dt><dd className="mono">{dev.runtime.protocol}</dd>
            <dt>{strings.dev.spec}</dt><dd className="mono">{dev.runtime.spec}</dd>
          </>
        )}
        <dt>{strings.dev.port}</dt><dd className="mono">127.0.0.1:{dev.port}</dd>
        <dt>{strings.dev.token}</dt>
        <dd data-testid="game-token"><span className="mono">{dev.tokenMasked ?? strings.dev.tokenNone}</span> <span className="dim">({strings.dev.tokenSources[dev.tokenSource]}{dev.tokenFrom ? `: ${dev.tokenFrom}` : ''})</span></dd>
      </dl>
      {connected && (
        <div data-testid="game-menus">
          <h4>{strings.dev.menusTitle}</h4>
          {dev.menus.length === 0 ? <p className="dim">{strings.dev.noMenus}</p> : (
            <ul className="plain">
              {dev.menus.map((m) => (
                <li key={m.name}><span className="mono">{m.name}</span> <span className={m.open ? 'tone-ok' : 'dim'}>{m.open ? strings.dev.menuOpen : strings.dev.menuClosed}</span></li>
              ))}
            </ul>
          )}
        </div>
      )}
      {dev.phase === 'noToken' && <p className="tone-warn">{strings.dev.noTokenHelp}</p>}
      <p className="dim">{dev.devDeploy ? strings.dev.devDeployOn : strings.dev.devDeployOff}</p>
      <div className="row-actions">
        {dev.phase === 'off' || dev.phase === 'noToken' || dev.phase === 'waiting' || dev.phase === 'unauthorized' || dev.phase === 'protocolMismatch' || dev.phase === 'refused' || dev.phase === 'busy'
          ? <Btn variant="primary" onClick={() => void inkwell?.devConnect()} testId="game-connect">{strings.dev.connect}</Btn> : null}
        {dev.phase !== 'off' && <Btn onClick={() => void inkwell?.devDisconnect()} testId="game-disconnect">{strings.dev.disconnect}</Btn>}
        <Btn onClick={() => void hotReload()} reason={connected || dev.devDeploy ? undefined : strings.dev.reloadNeedsGame} testId="game-reload">{strings.dev.hotReload}</Btn>
      </div>
      <h4>{strings.dev.pasteTitle}</h4>
      <p className="dim">{strings.dev.pasteHint}</p>
      <div className="row-actions">
        <input type="password" autoComplete="off" spellCheck={false} className="gn-input mono" placeholder={strings.dev.pastePlaceholder} value={token} onChange={(e) => setToken(e.target.value)} aria-label={strings.dev.pasteTitle} data-testid="game-token-input" />
        <Btn onClick={() => void useToken(token)} reason={token.trim() ? undefined : strings.dev.pastePlaceholder} testId="game-token-use">{strings.dev.pasteUse}</Btn>
        {dev.tokenSource === 'pasted' && <Btn onClick={() => void useToken(null)} testId="game-token-forget">{strings.dev.pasteClear}</Btn>}
      </div>
      <div className="row-actions">
        <label>{strings.dev.portLabel} <input type="number" min={1024} max={65535} className="gn-input mono port-input" value={port} onChange={(e) => setPort(e.target.value)} data-testid="game-port-input" /></label>
        <Btn onClick={() => void applyPort()} testId="game-port-set">{strings.dev.portSet}</Btn>
      </div>
      {problem && <p className="tone-error" role="alert" data-testid="game-problem">{problem}</p>}
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
