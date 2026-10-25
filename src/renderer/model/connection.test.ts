import { describe, expect, it } from 'vitest'
import type { SyncUiState } from '../../shared/syncState'
import { strings } from '../strings'
import { figmaConnection, figmaSelectReason } from './connection'

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
  it('disconnected with a usable figma/snapshot.json is "Disconnected (Using Snapshot)"; a broken one is not used', () => {
    const snap = { updatedAt: '2026-10-24T10:00:00Z', swfs: 1, stale: [] }
    expect(figmaConnection(s({}), snap)).toEqual({ status: 'snapshot', tone: 'off' })
    expect(figmaConnection(s({}), { ...snap, error: 'bad' }).status).toBe('disconnected')
    expect(figmaConnection(s({ connections: 1 }), snap).status).toBe('synced') // connected wins
    expect(figmaConnection(s({ connectionIssue: { kind: 'version', message: 'x' } }), snap).status).toBe('mismatch')
    expect(strings.top.figmaStatus['snapshot']).toBe('Disconnected (Using Snapshot)') // UX spec 4.6 wording
  })
  it('a plugin waiting for approval is amber "Waiting for approval"; after Allow it is connected', () => {
    const approval = { id: 1, pluginVersion: '1', fileName: 'F', origin: 'null' }
    expect(figmaConnection(s({ approval }))).toEqual({ status: 'pending', tone: 'warn' })
    expect(strings.top.figmaStatus['pending']).toBe('Waiting for approval')
    expect(figmaConnection(s({ connections: 1 }))).toEqual({ status: 'synced', tone: 'ok' })
  })
  it('a dead server is red; before the first answer it is grey', () => {
    expect(figmaConnection(s({ server: 'error' })).tone).toBe('error')
    expect(figmaConnection(undefined).status).toBe('starting')
  })
})

describe('Select / Focus in Figma availability', () => {
  const r = { notConnected: 'not connected', pending: 'pending' }
  it('enabled only with an approved connected plugin; otherwise the reason', () => {
    expect(figmaSelectReason(s({ connections: 1 }), r)).toBeUndefined()
    expect(figmaSelectReason(s({}), r)).toBe('not connected')
    expect(figmaSelectReason(undefined, r)).toBe('not connected')
    expect(figmaSelectReason(s({ approval: { id: 1, pluginVersion: '1', fileName: 'f', origin: 'null' } }), r)).toBe('pending')
  })
})
