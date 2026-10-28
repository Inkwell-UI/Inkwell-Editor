import { describe, expect, it } from 'vitest'
import { ROW_SETTINGS, checksForSetting, mergeResults, type CheckResult, type SettingKey } from './doctor'

const row = (id: CheckResult['id'], detail = ''): CheckResult => ({ id, label: id, status: 'pass', detail })

describe('which checks a setting affects', () => {
  it('every setting maps to at least one check, and each row edits settings that re-run that row', () => {
    const keys: SettingKey[] = ['javaPath', 'ffdecDir', 'papyrusExe', 'creationKitSources', 'skyrimPath', 'figmaManifest', 'mo2ModsDir', 'mo2ModName', 'mo2OverwriteDir']
    for (const k of keys) expect(checksForSetting(k).length).toBeGreaterThan(0)
    for (const [id, fields] of Object.entries(ROW_SETTINGS)) for (const f of fields!) expect(checksForSetting(f.key), `${id}/${f.key}`).toContain(id)
  })
  it('only the affected checks: a Java change does not re-run Skyrim or the vanilla cache', () => {
    expect(checksForSetting('javaPath')).toEqual(['java'])
    expect(checksForSetting('papyrusExe')).toEqual(['papyrus'])
    expect(checksForSetting('creationKitSources')).toEqual(['papyrus'])
    expect(checksForSetting('mo2ModName')).toEqual(['mo2', 'addresslib', 'runtime', 'skyui'])
  })
  it('a Skyrim change also re-runs what depends on it (vanilla cache, the Data guard of mo2)', () => {
    expect(checksForSetting('skyrimPath')).toEqual(['skyrim', 'vanilla', 'mo2', 'skse', 'addresslib'])
  })
})

describe('mergeResults', () => {
  it('replaces rows by id, keeps order and every other row', () => {
    const old = [row('java', 'old'), row('ffdec', 'old'), row('figma', 'old')]
    const m = mergeResults(old, [row('ffdec', 'new')])
    expect(m.map((r) => [r.id, r.detail])).toEqual([['java', 'old'], ['ffdec', 'new'], ['figma', 'old']])
    expect(old[1]!.detail).toBe('old') // input untouched
  })
  it('without earlier rows the fresh ones are the list; unknown rows are appended; nothing fresh changes nothing', () => {
    expect(mergeResults(undefined, [row('java')])).toHaveLength(1)
    expect(mergeResults([row('java')], [row('mo2')]).map((r) => r.id)).toEqual(['java', 'mo2'])
    expect(mergeResults([row('java', 'a')], [])[0]!.detail).toBe('a')
  })
})
