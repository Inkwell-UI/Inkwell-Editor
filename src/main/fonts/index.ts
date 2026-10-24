import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FIGMA_FACES, type FontToolErrorCode, type FontToolProgress, type FontToolResult, type FontToolStatus } from '../../shared/fonts'
import { extractEntry, openBsa } from '../vanilla/bsa'
import { convertFont, FSTYPE_FORBIDS_INSTALL, fsTypeLabel, matchFace, type ConvertedFont } from './convert'
import { fontStatus, FontToolError, installFonts, uninstallFonts, type FontSystem } from './install'

// "Install Skyrim fonts for Figma": BSA -> fonts_en.swf -> FFDec TTF export -> rename (convert.ts) -> per-user install (install.ts). Never automatic.

export interface FontToolDeps {
  sys: FontSystem
  /** Per-user fonts are Windows 10 1809+ only. */
  platformOk: boolean
  /** Skyrim - Interface.bsa of the detected install, or undefined. */
  findBsa(): Promise<string | undefined>
  ffdec(): { javaPath: string; ffdecDir: string }
  /** FFDec's font export of `swf` into `outDir` (one TTF per DefineFont). Injected in tests. */
  exportFonts?(swf: string, outDir: string): Promise<void>
  onProgress?(p: FontToolProgress): void
}

class Refused extends Error {
  constructor(readonly code: FontToolErrorCode, message: string) {
    super(message)
  }
}

const ffdecJar = (dir: string): string => join(dir, 'ffdec-cli.jar')

/** `java -jar ffdec-cli.jar -format font:ttf -export font <out> <swf>` (a one-off cold run; the resident wrapper has no font export). */
export const ffdecExport = (javaPath: string, ffdecDir: string) => (swf: string, outDir: string): Promise<void> =>
  new Promise((res, rej) =>
    execFile(javaPath, ['-jar', ffdecJar(ffdecDir), '-format', 'font:ttf', '-export', 'font', outDir, swf], { timeout: 180000, windowsHide: true, maxBuffer: 8 << 20 }, (e, _o, err) =>
      e ? rej(new Error(`FFDec font export failed: ${(err || e.message).trim().slice(0, 400)}`)) : res()
    )
  )

/** The fonts in the archive's Interface/fonts_en.swf, converted. Works in a temp folder that is always removed. */
export async function extractFonts(bsaPath: string, exportFonts: (swf: string, outDir: string) => Promise<void>, onProgress?: (p: FontToolProgress) => void): Promise<{ fonts: ConvertedFont[]; warnings: string[] }> {
  const bsa = openBsa(bsaPath)
  const e = bsa.entries.find((x) => `${x.folder}/${x.name}`.toLowerCase() === 'interface/fonts_en.swf')
  if (!e) throw new Refused('export-failed', `interface/fonts_en.swf is not in ${bsaPath}.`)
  const dir = await mkdtemp(join(tmpdir(), 'inkwell-fonts-'))
  try {
    const swf = join(dir, 'fonts_en.swf')
    await writeFile(swf, extractEntry(bsa, e))
    const raw = join(dir, 'raw')
    await mkdir(raw)
    onProgress?.({ step: 'export' })
    await exportFonts(swf, raw).catch((x: unknown) => { throw new Refused('export-failed', x instanceof Error ? x.message : String(x)) })
    onProgress?.({ step: 'convert' })
    const fonts: ConvertedFont[] = []
    for (const f of (await readdir(raw)).filter((n) => n.toLowerCase().endsWith('.ttf')).sort()) {
      const bytes = await readFile(join(raw, f))
      const face = matchFace(bytes)
      if (face && !fonts.some((x) => x.face === face)) fonts.push(convertFont(bytes, face))
    }
    const missing = FIGMA_FACES.filter((f) => !fonts.some((x) => x.face === f)).map((f) => `${f.family}/${f.style}`)
    if (missing.some((m) => m.startsWith('Everywhere/'))) throw new Refused('faces-missing', `FFDec's export lacks ${missing.join(', ')}; this game version's fonts_en.swf is not the one Inkwell knows.`)
    return { fonts, warnings: missing.length ? [`Not found in fonts_en.swf, so not installed: ${missing.join(', ')}.`] : [] }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** Refuses the whole install when any face's fsType forbids installing it. */
export function fsTypeGate(fonts: ConvertedFont[]): void {
  const bad = fonts.filter((f) => f.fsType & FSTYPE_FORBIDS_INSTALL)
  if (bad.length) throw new Refused('fstype', `The embedding flags of ${bad.map((f) => `${f.face.family}/${f.face.style} (fsType ${f.fsType}, ${fsTypeLabel(f.fsType)})`).join(', ')} forbid installing them. Nothing was installed.`)
}

export function createFontTool(deps: FontToolDeps) {
  let busy = false
  const status = (): Promise<FontToolStatus> => fontStatus(deps.sys, deps.platformOk)
  const fail = async (e: unknown): Promise<FontToolResult> => {
    const code: FontToolErrorCode = e instanceof Refused || e instanceof FontToolError ? e.code : 'failed'
    const st = await status().catch(() => ({ platformOk: deps.platformOk, installed: false, faces: [], fontsDir: deps.sys.fontsDir, manifestPath: deps.sys.manifestPath }))
    return { ok: false, code, error: e instanceof Error ? e.message : String(e), status: st }
  }
  const job = async (fn: () => Promise<string[]>): Promise<FontToolResult> => {
    if (busy) return fail(new Refused('busy', 'The font tool is already running.'))
    busy = true
    try {
      const warnings = await fn()
      return { ok: true, status: await status(), warnings }
    } catch (e) {
      return fail(e)
    } finally {
      busy = false
    }
  }
  return {
    status,
    install: (): Promise<FontToolResult> =>
      job(async () => {
        if (!deps.platformOk) throw new Refused('not-windows', 'Per-user font install needs Windows 10 (1809) or newer.')
        if ((await status()).installed) throw new Refused('already-installed', `The fonts are already installed (manifest ${deps.sys.manifestPath}). Remove them first.`)
        deps.onProgress?.({ step: 'game' })
        const bsa = await deps.findBsa()
        if (!bsa) throw new Refused('game-not-found', 'Skyrim - Interface.bsa was not found. Fix the Skyrim install check below first.')
        const { javaPath, ffdecDir } = deps.ffdec()
        if (!deps.exportFonts && !existsSync(ffdecJar(ffdecDir))) throw new Refused('ffdec-missing', `ffdec-cli.jar was not found in ${ffdecDir}. Fix the FFDec check below first.`)
        const { fonts, warnings } = await extractFonts(bsa, deps.exportFonts ?? ffdecExport(javaPath, ffdecDir), deps.onProgress)
        fsTypeGate(fonts)
        await installFonts(fonts, deps.sys, (done, total) => deps.onProgress?.({ step: 'install', done, total }))
        return warnings
      }),
    remove: (): Promise<FontToolResult> => job(() => uninstallFonts(deps.sys, (done, total) => deps.onProgress?.({ step: 'remove', done, total })))
  }
}
