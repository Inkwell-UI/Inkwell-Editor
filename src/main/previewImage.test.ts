import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readPreviewImage } from './previewImage'

describe('readPreviewImage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pvimg-'))
  const png = join(dir, 'a.PNG')
  writeFileSync(png, Buffer.from([1, 2, 3]))
  writeFileSync(join(dir, 'a.txt'), 'x')

  it('reads an image by absolute path with its mime type', async () => {
    expect(await readPreviewImage(png)).toEqual({ ok: true, mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) })
  })

  it('refuses non-images, relative paths, missing files and non-strings without throwing', async () => {
    for (const p of [join(dir, 'a.txt'), 'a.png', join(dir, 'gone.png'), dir, 42, undefined]) expect(await readPreviewImage(p)).toEqual({ ok: false })
  })
})
