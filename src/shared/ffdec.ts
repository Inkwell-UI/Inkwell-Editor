import type { FfdecState } from './syncState'

/** FFDec status from facts (main computes the facts; pure so it is testable). `warm` = the resident wrapper has run a build. */
export function ffdecState(f: { installed: boolean; jarBuilt: boolean; javaOk: boolean; everBuilt: boolean }): FfdecState {
  if (!f.installed) return { status: 'notFound', reason: 'ffdec' }
  if (!f.jarBuilt) return { status: 'notFound', reason: 'wrapper' }
  if (!f.javaOk) return { status: 'notFound', reason: 'java' }
  return { status: f.everBuilt ? 'warm' : 'cold' }
}
