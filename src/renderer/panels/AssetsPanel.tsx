import { strings } from '../strings'
import { Btn } from '../ui/Btn'
import { PacksSection } from '../packs/PacksSection'
import { Panel } from './Panel'

/** Zone 2, tab 3 (UX 4.2): Imported AS2 classes (not scheduled, an honest empty state) and the Node packs of packs.lock (0.5). */
export function AssetsPanel() {
  return (
    <Panel title={strings.assets.title}>
      <div className="nav">
        {strings.assets.sections.map((s) =>
          s.id === 'packs' ? (
            <PacksSection key={s.id} title={s.title} empty={s.empty} />
          ) : (
            <section key={s.id} aria-labelledby={`assets-${s.id}`}>
              <header className="section-title">
                <h3 id={`assets-${s.id}`}>{s.title}</h3>
                <Btn label={`${s.action}: ${s.title}`} reason={s.reason}>{s.action}</Btn>
              </header>
              <p className="empty">{s.empty}</p>
            </section>
          )
        )}
      </div>
    </Panel>
  )
}
