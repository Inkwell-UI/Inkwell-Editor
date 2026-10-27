import type { PackIndexEntry, PackLockEntry } from '@inkwell-ui/spec'

/** One `packs.lock` entry and whether the project's pack cache holds exactly it (docs/packs.md in Inkwell-Core-Pack; editor docs/graphs.md, Downloaded packs). */
export interface LockedPack extends PackLockEntry {
  /** `ok`: loaded from the cache; `missing`: not downloaded yet (its nodes stay as unknown pack nodes); `mismatch`: the cached file's SHA-256 is not the lockfile's, so it is not loaded. */
  state: 'ok' | 'missing' | 'mismatch'
}

/** The Node packs section of the Assets panel. `lockError`: packs.lock exists but cannot be read; it is then never written. */
export interface PacksState {
  locked: LockedPack[]
  lockError?: string
}

/** A downloaded pack waiting for the user's yes (install or update dialog). Nothing is written before `installPack(token)`. */
export interface PackCandidate {
  token: string
  id: string
  version: string
  /** `owner/name` on GitHub. */
  repo: string
  /** The release asset URL that goes into packs.lock. */
  source: string
  /** SHA-256 of the downloaded asset (the content hash shown before install). */
  sha256: string
  /** The locked version this replaces, if the pack is already in packs.lock. */
  current?: string
  /** CHANGELOG.md of the pack, '' when it has none. */
  changelog: string
  nodes: number
  /** The index marks the pack deprecated (the reason). */
  deprecated?: string
}

export type PackResult<T = object> = ({ ok: true } & T) | { ok: false; error: string }
export type { PackIndexEntry }
