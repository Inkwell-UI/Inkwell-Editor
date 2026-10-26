import { usePackList } from '../hooks/usePacks'
import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Panel } from './Panel'

/** Zone 2, tab 3 (UX 4.2): Imported AS2 classes (not scheduled, an honest empty state) and the loaded Node packs. */
export function AssetsPanel() {
  const packs = usePackList()
  return (
    <Panel title={strings.assets.title}>
      <div className="nav">
        {strings.assets.sections.map((s) => (
          <section key={s.id} aria-labelledby={`assets-${s.id}`}>
            <header className="section-title">
              <h3 id={`assets-${s.id}`}>{s.title}</h3>
              <Btn label={`${s.action}: ${s.title}`} reason={s.reason}>{s.action}</Btn>
            </header>
            {s.id === 'packs' && packs.length > 0 ? (
              <ul className="plain" data-testid="pack-list">
                {packs.map((p) => <li key={p.id}><span className="mono">{p.id}</span> {p.version} <span className="dim">{strings.assets.packNodes(p.nodes)}</span></li>)}
              </ul>
            ) : (
              <p className="empty">{s.empty}</p>
            )}
          </section>
        ))}
      </div>
    </Panel>
  )
}
