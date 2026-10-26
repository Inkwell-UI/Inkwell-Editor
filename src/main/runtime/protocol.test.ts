import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseIni } from '@inkwell-ui/spec'
import { describe, expect, it } from 'vitest'
import { formatDevValue, maskToken, reloadSummary } from '../../shared/devLink'
import { devIniText, generateToken, normalizeToken, readDevIni, RUNTIME_INI_REL } from './devIni'
import { freshCore, helloMessage, parseServerMessage, reduce } from './protocol'
import { resolveDevConfig, withDevToken } from './token'

const TOKEN = '0123456789abcdef'.repeat(4)
const ack = { type: 'helloAck', ok: true, runtimeVersion: 196608, runtimeVersionString: '0.3.0', protocolVersion: 1, specVersion: 6, gameVersion: '1.6.1170', menus: [{ name: 'A', swf: 'a.swf', open: false }] }

describe('pure message handling', () => {
  it('parses known messages and ignores unknown types, bad shapes and non-JSON', () => {
    expect(parseServerMessage(JSON.stringify(ack))?.type).toBe('helloAck')
    expect(parseServerMessage('{"type":"zzz"}')).toBeUndefined()
    expect(parseServerMessage('{"type":"trace","text":1}')).toBeUndefined()
    expect(parseServerMessage('nope')).toBeUndefined()
    expect(parseServerMessage('{"type":"ping","id":4,"extra":true}')).toMatchObject({ type: 'ping', id: 4 })
  })
  it('hello carries the token and both versions', () => {
    expect(helloMessage(TOKEN, '1.2.3')).toEqual({ type: 'hello', token: TOKEN, editorVersion: '1.2.3', protocolVersion: 1, specVersion: 6 })
  })
  it('helloAck ok connects and subscribes to every menu with watch and pins', () => {
    const s = reduce(freshCore('connecting'), parseServerMessage(JSON.stringify(ack))!, 0)
    expect(s.core.phase).toBe('connected')
    expect(s.send).toEqual([{ type: 'subscribe', menu: 'A', watch: true, pins: true }])
  })
  it('each refusal maps to its own phase and says whether to retry', () => {
    const r = (error?: string) => reduce(freshCore('connecting'), parseServerMessage(JSON.stringify({ ...ack, ok: false, error }))!, 0)
    expect(r('unauthorized')).toMatchObject({ core: { phase: 'unauthorized' }, close: { retry: 'never' } })
    expect(r('protocol-mismatch')).toMatchObject({ core: { phase: 'protocolMismatch' }, close: { retry: 'never' } })
    expect(r('busy')).toMatchObject({ core: { phase: 'busy' }, close: { retry: 'slow' } })
    expect(new Set(['unauthorized', 'protocol-mismatch', 'busy'].map((e) => r(e).core.message)).size).toBe(3) // distinct messages
  })
  it('an error busy before any helloAck (what the runtime sends the second editor) is the busy state', () => {
    const s = reduce(freshCore('connecting'), parseServerMessage('{"type":"error","code":"busy","message":"x"}')!, 0)
    expect(s.core.phase).toBe('busy')
  })
  it('trace, watch and pin outside a session are dropped', () => {
    expect(reduce(freshCore('connecting'), parseServerMessage('{"type":"pin","menu":"A","node":"n","pin":"v","value":1}')!, 0).events).toEqual([])
  })
})

describe('devLink helpers', () => {
  it('masks a token to first four and last four', () => {
    expect(maskToken(TOKEN)).toBe('0123...cdef')
    expect(maskToken('short')).toBe('****')
  })
  it('formats values like the preview does', () => {
    expect(formatDevValue('hi')).toBe('"hi"')
    expect(formatDevValue(3)).toBe('3')
    expect(formatDevValue(false)).toBe('false')
    expect(formatDevValue(null)).toBe('null')
    expect(formatDevValue('[1,2]')).toBe('[1,2]')
  })
  it('summarises a reload ack', () => {
    expect(reloadSummary({ ok: true, reloaded: ['A'], skipped: [], ms: 120.4 })).toBe('hot reload: reloaded A in 120 ms')
    expect(reloadSummary({ ok: false, reloaded: [], skipped: [], ms: 0, error: 'bad' })).toBe('hot reload failed: bad')
  })
})

describe('Inkwell.ini writer (O5)', () => {
  it('generates 64 lower-case hex digits and accepts a pasted token in sloppy form', () => {
    expect(generateToken()).toMatch(/^[0-9a-f]{64}$/)
    expect(generateToken()).not.toBe(generateToken())
    expect(normalizeToken(`  "${TOKEN.toUpperCase()}"\n`)).toBe(TOKEN)
    expect(normalizeToken('abc')).toBeUndefined()
    expect(normalizeToken(TOKEN + 'a')).toBeUndefined()
  })
  it('a fresh file has [Dev] DevMode=1, Token and Port', () => {
    const t = devIniText(undefined, { token: TOKEN, port: 8790 })
    expect(t).toContain('[Dev]')
    expect(t).toContain('DevMode=1')
    expect(t).toContain(`Token=${TOKEN}`)
    expect(t).toContain('Port=8790')
    expect(parseIni(t, 'runtime').ini.dev).toEqual({ devMode: true, port: 8790, token: TOKEN })
  })
  it('keeps LogLevel and Watch of an existing file and replaces an old token', () => {
    const old = '[Runtime]\nLogLevel=debug\n\n[Dev]\nDevMode=0\nWatch=0\nToken=' + 'f'.repeat(64) + '\n'
    const { ini, problems } = parseIni(devIniText(old, { token: TOKEN, port: 8788 }), 'runtime')
    expect(problems).toEqual([])
    expect(ini.runtime?.logLevel).toBe('debug')
    expect(ini.dev).toEqual({ devMode: true, watch: false, port: 8788, token: TOKEN })
  })
  it('survives a damaged existing file', () => {
    expect(readDevIni(devIniText('garbage ] [ = =\n[Dev\nToken=zz', { token: TOKEN, port: 8788 })).token).toBe(TOKEN)
  })
})

describe('token source order (UX 4.6)', () => {
  const root = (token?: string, port?: number): string => {
    const d = mkdtempSync(join(tmpdir(), 'inkwell-tok-'))
    if (token) {
      mkdirSync(join(d, 'SKSE', 'Plugins', 'Inkwell'), { recursive: true })
      writeFileSync(join(d, ...RUNTIME_INI_REL.split('/')), devIniText(undefined, { token, port: port ?? 8788 }))
    }
    return d
  }
  const A = 'a'.repeat(64)
  const B = 'b'.repeat(64)
  const C = 'c'.repeat(64)
  it('pasted > MO2 overwrite > deploy target > the token the editor made', async () => {
    const over = root(A, 9001)
    const dep = root(B)
    expect(await resolveDevConfig({ link: { token: B, pasted: C }, overwriteDir: over, deployRoot: dep })).toMatchObject({ token: C, source: 'pasted' })
    expect(await resolveDevConfig({ link: { token: C }, overwriteDir: over, deployRoot: dep })).toMatchObject({ token: A, source: 'overwrite', port: 9001 })
    expect(await resolveDevConfig({ link: { token: C }, overwriteDir: root(), deployRoot: dep })).toMatchObject({ token: B, source: 'deploy' })
    expect(await resolveDevConfig({ link: { token: C, port: 8800 }, overwriteDir: root(), deployRoot: root() })).toMatchObject({ token: C, source: 'editor', port: 8800 })
    expect(await resolveDevConfig({})).toBeUndefined()
  })
})

describe('withDevToken (deploy:menu-nodes --dev)', () => {
  it('stores a new token under the lower-case project folder and keeps an existing one', () => {
    const a = withDevToken({ mo2ModsDir: 'X' }, 'C:\Proj\Menu', () => TOKEN)
    expect(a.token).toBe(TOKEN)
    expect(a.settings.devLinks?.[resolve('C:\Proj\Menu').toLowerCase()]).toEqual({ token: TOKEN, port: 8788 })
    expect(a.settings.mo2ModsDir).toBe('X')
    const b = withDevToken(a.settings, 'C:\Proj\Menu', () => 'f'.repeat(64))
    expect(b.token).toBe(TOKEN)
  })
})
