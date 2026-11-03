import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Layer rule: renderer, main and shared never import each other except downward into shared. Tests may cross (fixtures).
const SRC = join(__dirname, '..')
const files = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) && !/\.(test|testutil)\.tsx?$/.test(n) ? [p] : [] })
const bad = (layer: string, forbidden: string[]): string[] =>
  files(join(SRC, layer)).filter((f) => forbidden.some((x) => new RegExp(`from '(\.\./)+${x}/`).test(readFileSync(f, 'utf8'))))

describe('layers', () => {
  it('renderer does not import main', () => expect(bad('renderer', ['main'])).toEqual([]))
  it('main does not import renderer', () => expect(bad('main', ['renderer'])).toEqual([]))
  it('shared imports neither', () => expect(bad('shared', ['main', 'renderer'])).toEqual([]))
})
