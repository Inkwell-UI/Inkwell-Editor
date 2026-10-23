import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { Panel } from './Panel'

/** Zone 2, tab 3 (UX 4.2): Variables, Imported AS2 classes and Node packs. All three belong to later milestones, so each is an honest empty state. */
export function AssetsPanel() {
  return (
    <Panel title={strings.assets.title}>
      <div className="nav">
        {strings.assets.sections.map((s) => (
          <section key={s.id} aria-labelledby={`assets-${s.id}`}>
            <header className="section-title">
              <h3 id={`assets-${s.id}`}>{s.title}</h3>
              <Btn label={`${s.action}: ${s.title}`} reason={s.reason}>{s.action}</Btn>
            </header>
            <p className="empty">{s.empty}</p>
          </section>
        ))}
        <p className="dim">{strings.assets.packsNone}</p>
      </div>
    </Panel>
  )
}
