import { describe, expect, it } from 'vitest'
import type { SyncUiState } from '../../shared/syncState'
import { figmaConnection } from './connection'

const s = (o: Partial<SyncUiState>): SyncUiState => ({ server: 'listening', connections: 0, build: 'idle', lintCount: 0, swfCount: 0, orphanedCount: 0, ...o })

describe('figma connection dot', () => {
  it('connected is green: synced, or patching while compiling', () => {
    expect(figmaConnection(s({ connections: 1 }))).toEqual({ status: 'synced', tone: 'ok' })
    expect(figmaConnection(s({ connections: 1, build: 'compiling' }))).toEqual({ status: 'patching', tone: 'ok' })
  })
  it('version mismatch is amber, auth failure is red, nothing is grey', () => {
    expect(figmaConnection(s({ connectionIssue: { kind: 'version', message: 'x' } })).tone).toBe('warn')
    expect(figmaConnection(s({ connectionIssue: { kind: 'auth', message: 'x' } })).tone).toBe('error')
    expect(figmaConnection(s({}))).toEqual({ status: 'disconnected', tone: 'off' })
  })
  it('a dead server is red; before the first answer it is grey', () => {
    expect(figmaConnection(s({ server: 'error' })).tone).toBe('error')
    expect(figmaConnection(undefined).status).toBe('starting')
  })
})
