import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createFfdecWrapper, type ChildLike } from './ffdecWrapper'

class FakeChild extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  sent: { id: string; out: string }[] = []
  killed = false
  constructor() {
    super()
    this.stdin.setEncoding('utf8')
    this.stdin.on('data', (d: string) => d.split('\n').filter(Boolean).forEach((l) => this.sent.push(JSON.parse(l))))
    this.stdout.write('{"ready":true,"ffdec":"26.3.0","pinned":"26.3.0","match":true}\n')
  }
  reply(id: string, extra: object = {}): void {
    this.stdout.write(JSON.stringify({ id, ok: true, ms: 5, ...extra }) + '\n')
  }
  kill(): void {
    this.killed = true
  }
}

const tick = () => new Promise((r) => setTimeout(r, 10))

function setup() {
  const children: FakeChild[] = []
  const w = createFfdecWrapper({
    javaPath: 'java',
    ffdecDir: 'F',
    jarPath: 'w.jar',
    spawn: () => {
      const c = new FakeChild()
      children.push(c)
      return c as unknown as ChildLike
    }
  })
  return { w, children }
}
const job = (out: string) => ({ base: 'b.swf', out })

describe('ffdec wrapper client', () => {
  it('sends one job at a time and resolves with timing', async () => {
    const { w, children } = setup()
    const a = w.build(job('a.swf'))
    const b = w.build(job('b.swf'))
    await tick()
    expect(children[0]!.sent.map((s) => s.out)).toEqual(['a.swf'])
    children[0]!.reply('1')
    expect(await a).toMatchObject({ ok: true, ms: 5 })
    await tick()
    expect(children[0]!.sent.map((s) => s.out)).toEqual(['a.swf', 'b.swf'])
    children[0]!.reply('2', { ok: false, error: 'bad' })
    expect(await b).toMatchObject({ ok: false, error: 'bad' })
    expect(w.info.versionMatch).toBe(true)
    expect(w.timer.builds().map((x) => Object.keys(x.stages))).toEqual([['ffdec'], ['ffdec']])
    expect(children).toHaveLength(1) // stayed resident
  })

  it('drops stale queued jobs for the same output', async () => {
    const { w, children } = setup()
    const first = w.build(job('a.swf'))
    const stale = w.build(job('b.swf'))
    const fresh = w.build(job('b.swf'))
    expect(await stale).toMatchObject({ ok: false, cancelled: true })
    await tick()
    children[0]!.reply('1')
    await first
    await tick()
    expect(children[0]!.sent.map((s) => s.id)).toEqual(['1', '3'])
    children[0]!.reply('3')
    expect(await fresh).toMatchObject({ ok: true })
  })

  it('fails the running job when the process dies and restarts for the next one', async () => {
    const { w, children } = setup()
    const a = w.build(job('a.swf'))
    const b = w.build(job('b.swf'))
    await tick()
    children[0]!.emit('exit')
    expect(await a).toMatchObject({ ok: false, error: expect.stringContaining('died') })
    await tick()
    expect(children).toHaveLength(2)
    expect(children[1]!.sent.map((s) => s.out)).toEqual(['b.swf'])
    children[1]!.reply('2')
    expect(await b).toMatchObject({ ok: true })
  })

  it('stop kills the process and settles pending builds', async () => {
    const { w, children } = setup()
    const a = w.build(job('a.swf'))
    const b = w.build(job('b.swf'))
    await tick()
    w.stop()
    expect(children[0]!.killed).toBe(true)
    expect((await a).ok).toBe(false)
    expect(await b).toMatchObject({ cancelled: true })
  })
})
