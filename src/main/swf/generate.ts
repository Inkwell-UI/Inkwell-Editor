import type { Swf } from '@inkwell-ui/spec'
import { ddsRel, type ImageMode } from '../images/assets'
import type { Rgba } from '../images/png'
import { ident } from '../../shared/overlay'
import { issue, type LintIssue } from './lint'
import { shapeToSvg } from './svg'
import * as T from './tags'
import { mapText, previewDeviceFont, type FontInfo, type TextScript } from './text'
import { HUD_SCALE, widgetFrame } from '../widget/frame'
import { widgetContractClass } from '../widget/widgetAs2'

export interface GenerateOptions {
  /** Mod id: AS2 classes live under `mods.<modId>.*`. */
  modId: string
  /** Overlay instance names by node id; the default is the sanitized layer name. */
  instanceNames?: Record<string, string>
  /** HUD widget output: the first frame becomes the root clip `widget` (SkyUI contract AS2, scaled 2/3 into the 1280x720 HUD space). */
  widget?: boolean
  /**
   * Preview SWF for Ruffle: the same content, but text uses a device font (no ImportAssets2, no fontId/outlines), the frame code starts
   * with the preview shims (skse, gfxExtensions, bridge stubs), and `widget` is ignored: the design frame shows at the design size.
   */
  preview?: boolean
  /** Preview only: device font name per alias (a font Ruffle has loaded by name); default `previewDeviceFont` (_sans, _typewriter, _serif). */
  previewFont?: (alias: string) => string
  /**
   * Preview only: TTF bytes for a font name. A name that has bytes is EMBEDDED (placeholder DefineFont3 + fontId + outlines; the glyphs are
   * imported by the FFDec `fonts` step), because Ruffle draws device-font text nothing when rotated or alpha-blended. Others stay device fonts.
   */
  previewFontBytes?: (fontName: string) => Buffer | undefined
  /**
   * How bitmaps reach the game (project setting `imageMode`, see docs/images.md): 'embedded' (default) compiles them into the SWF
   * (DefineBitsLossless2); 'dds' places an empty clip per image and AS2 loads `img://textures/Inkwell/<mod>/<hash>.dds` into it. The preview always embeds.
   */
  imageMode?: ImageMode
  /** Decoded pixels by image hash (the project's assets/<hash>.png); undefined = missing (lint `image-missing-asset`). */
  images?: (hash: string) => Rgba | undefined
}

export interface Generated {
  /** Complete tag list, ready for `writeSwf` (ends with ShowFrame + End). */
  tags: Buffer[]
  /** SVG per shape, keyed by SWF character id (the file name FFDec -importShapes expects) and mapped to its node id. */
  shapes: { charId: number; nodeId: string; svg: string }[]
  /** AS2 files relative to the scripts folder. */
  as2: { path: string; source: string }[]
  lint: LintIssue[]
  /** One entry per text node: how its font resolved. Not lint. */
  fonts: (FontInfo & { nodeId: string; nodeName: string })[]
  stage: { width: number; height: number }
  /** Preview only: embedded fonts (placeholder character id, font name, characters to import: the text plus printable ASCII). */
  embeddedFonts: { charId: number; name: string; chars: string }[]
  /** Text nodes that need GFx TextField extensions (verticalAlign, textAutoSize, letterSpacing); Ruffle ignores the first two. */
  gfxTextExtensions: number
  /** Images the game SWF loads at runtime from DDS (dds mode; 0 when embedded or in the preview). */
  ddsImages: number
}

/** Max image side in px (lint `image-too-large`). */
export const MAX_IMAGE_SIDE = 2048

/** Where a bitmap of iw x ih goes in a w x h box: the drawn rectangle and the bitmap's scale and top-left offset (px). */
export function fitImage(mode: 'fill' | 'fit' | 'tile', iw: number, ih: number, w: number, h: number): { rect: { x: number; y: number; w: number; h: number }; scale: number; tx: number; ty: number; repeat?: boolean } {
  if (mode === 'tile') return { rect: { x: 0, y: 0, w, h }, scale: 1, tx: 0, ty: 0, repeat: true }
  const scale = mode === 'fit' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih)
  const tx = (w - iw * scale) / 2
  const ty = (h - ih * scale) / 2
  return { rect: mode === 'fit' ? { x: tx, y: ty, w: iw * scale, h: ih * scale } : { x: 0, y: 0, w, h }, scale, tx, ty }
}

const pot = (v: number): boolean => v > 0 && (v & (v - 1)) === 0
const num = (n: number): string => String(Math.round(n * 1000) / 1000)

const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('')

export { ident } // shared with the editor UI (default instance names); one definition in shared/overlay.ts

const comment = (s: string): string => s.replace(/[\r\n]+/g, ' ').replace(/\*\//g, '* /')
const lit = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')

interface ScriptItem {
  nodeId: string
  layer: string
  path: string
  script: TextScript
}

/** The AS2 class that applies GFx text extensions. Tiny, readable, one try/catch per node, errors logged as strings (no Error class in GFx). */
function layoutClass(modId: string, cls: string, swfId: string, items: ScriptItem[]): string {
  const spacing = items.some((i) => i.script.letterSpacing !== undefined)
  const out = [
    `// Generated by Inkwell for SWF "${comment(swfId)}". Do not edit; each block below is tagged with the Figma node id it came from.`,
    `class mods.${modId}.${cls} {`
  ]
  if (spacing) {
    out.push(
      '    static function letterSpacing(t, px) {',
      '        var f = t.getTextFormat();',
      '        f.letterSpacing = px;',
      '        t.setTextFormat(f);',
      '        t.setNewTextFormat(f);',
      '    }',
      ''
    )
  }
  out.push('    static function apply(root) {', '        _global.gfxExtensions = true;')
  for (const it of items) {
    const s = it.script
    out.push(`        // node ${comment(it.nodeId)} "${comment(it.layer)}"`, '        try {', `            var t = ${it.path};`)
    if (s.verticalAlign) out.push(`            t.verticalAlign = "${s.verticalAlign}";`)
    if (s.textAutoSize) out.push(`            t.textAutoSize = "${s.textAutoSize}";`)
    if (s.letterSpacing !== undefined) out.push(`            mods.${modId}.${cls}.letterSpacing(t, ${Math.round(s.letterSpacing * 1000) / 1000});`)
    out.push('        } catch (e) {', `            trace("[Inkwell] node ${lit(it.nodeId)}: " + e);`, '        }')
  }
  out.push('    }', '}', '')
  return out.join('\n')
}

interface ImageLoad {
  nodeId: string
  layer: string
  path: string
  url: string
  w: number
  h: number
  iw: number
  ih: number
  mode: 'fill' | 'fit'
}

/**
 * dds mode: loads each image into an empty child clip with MovieClipLoader and scales it once loaded (Flash 7 API, within Flash 8 level).
 * Log lines go to trace and, when present, the spike runtime's `_root.inkwellTrace` (Inkwell.log), so an in-game test shows what happened.
 */
function imagesClass(modId: string, cls: string, swfId: string, loads: ImageLoad[]): string {
  const me = `mods.${modId}.${cls}`
  const out = [
    `// Generated by Inkwell for SWF "${comment(swfId)}". Do not edit; each block below is tagged with the Figma node id it came from.`,
    `class ${me} {`,
    '    static function log(s) {',
    '        trace(s);',
    '        if (_root.inkwellTrace != undefined) _root.inkwellTrace(s);',
    '    }',
    '',
    '    // iw/ih: the source size, used when the loaded image reports no size. "fill" crops to the box with a mask.',
    '    static function load(holder, url, w, h, iw, ih, mode, node) {',
    '        var c = holder.createEmptyMovieClip("img", 1);',
    '        if (typeof MovieClipLoader != "function") {',
    `            ${me}.log("[Inkwell] image " + node + ": no MovieClipLoader, loadMovie without sizing " + url);`,
    '            c.loadMovie(url);',
    '            return;',
    '        }',
    '        var l = new MovieClipLoader();',
    '        var o = new Object();',
    '        o.onLoadInit = function(t) {',
    '            try {',
    '                var lw = t._width;',
    '                var lh = t._height;',
    '                if (!(lw > 0) || !(lh > 0)) { lw = iw; lh = ih; }',
    '                var s = mode == "fit" ? Math.min(w / lw, h / lh) : Math.max(w / lw, h / lh);',
    '                t._xscale = s * 100;',
    '                t._yscale = s * 100;',
    '                t._x = (w - lw * s) / 2;',
    '                t._y = (h - lh * s) / 2;',
    '                if (mode == "fill") {',
    '                    var m = holder.createEmptyMovieClip("mask", 2);',
    '                    m.beginFill(0, 100);',
    '                    m.moveTo(0, 0); m.lineTo(w, 0); m.lineTo(w, h); m.lineTo(0, h); m.lineTo(0, 0);',
    '                    m.endFill();',
    '                    t.setMask(m);',
    '                }',
    `                ${me}.log("[Inkwell] image " + node + " loaded " + url + ": reported " + lw + "x" + lh + ", now " + t._width + "x" + t._height);`,
    '            } catch (e) {',
    `                ${me}.log("[Inkwell] image " + node + ": " + e);`,
    '            }',
    '        };',
    `        o.onLoadError = function(t, err) { ${me}.log("[Inkwell] image " + node + " failed to load " + url + ": " + err); };`,
    '        l.addListener(o);',
    '        l.loadClip(url, c);',
    '    }',
    '',
    '    static function apply(root) {'
  ]
  for (const i of loads)
    out.push(
      `        // node ${comment(i.nodeId)} "${comment(i.layer)}"`,
      '        try {',
      `            ${me}.load(${i.path}, "${lit(i.url)}", ${num(i.w)}, ${num(i.h)}, ${i.iw}, ${i.ih}, "${i.mode}", "${lit(i.nodeId)}");`,
      '        } catch (e) {',
      `            ${me}.log("[Inkwell] node ${lit(i.nodeId)}: " + e);`,
      '        }'
    )
  out.push('    }', '}', '')
  return out.join('\n')
}

/** IR -> SWF skeleton tags + SVGs + AS2 sources. Pure: no files, no FFDec. */
export function generate(ir: Swf, opts: GenerateOptions): Generated {
  const lint: LintIssue[] = []
  const defs: Buffer[] = []
  const shapes: Generated['shapes'] = []
  const embedded = new Map<string, { charId: number; chars: Set<string> }>() // preview: font name -> placeholder DefineFont3
  const fonts = new Map<string, number>() // alias -> local character id (ImportAssets2)
  const scripts: ScriptItem[] = []
  const fontRows: Generated['fonts'] = []
  let nextId = 1
  const alloc = (): number => nextId++
  const seen = new Set<string>()
  const imageMode: ImageMode = opts.preview ? 'embedded' : (opts.imageMode ?? 'embedded')
  const bitmaps = new Map<string, number>() // hash -> DefineBitsLossless2 id (one per image, shared)
  const loads: ImageLoad[] = []

  /** One clip (sprite) showing image `hash` in a w x h box; undefined (with lint) when it cannot be drawn. */
  const imageClip = (hash: string, scaleMode: string | undefined, w: number, h: number, nodeId: string, layer: string, path: string): number | undefined => {
    const want = scaleMode ?? 'fill'
    const mode: 'fill' | 'fit' | 'tile' = want === 'fit' ? 'fit' : want === 'tile' && imageMode === 'embedded' ? 'tile' : 'fill'
    if (want === 'crop') lint.push(issue('warning', 'image-scale-mode', nodeId, 'Scale mode CROP is drawn as FILL (the crop rectangle is not applied).'))
    else if (want === 'tile') lint.push(issue('warning', 'image-scale-mode', nodeId, imageMode === 'embedded' ? 'Scale mode TILE repeats the image at its own pixel size (the Figma tile scale is not applied).' : 'Scale mode TILE is drawn as FILL in dds mode.'))
    else if (want !== 'fill' && want !== 'fit') lint.push(issue('warning', 'image-scale-mode', nodeId, `Unknown scale mode "${want}"; drawn as FILL.`))
    const img = opts.images?.(hash)
    if (!img) {
      lint.push(issue('error', 'image-missing-asset', nodeId, `Image ${hash.slice(0, 8)} is not in the project's assets (missing or unreadable); it syncs from Figma while the plugin is connected.`))
      return undefined
    }
    if (!(w > 0 && h > 0)) {
      lint.push(issue('info', 'image-empty', nodeId, 'Image box has no size; skipped.'))
      return undefined
    }
    if (Math.max(img.width, img.height) > MAX_IMAGE_SIDE) lint.push(issue('error', 'image-too-large', nodeId, `Image is ${img.width}x${img.height} px; the limit is ${MAX_IMAGE_SIDE} px per side. Scale it down in Figma.`))
    if (imageMode === 'dds' && !(pot(img.width) && pot(img.height))) lint.push(issue('warning', 'image-not-power-of-two', nodeId, `Image is ${img.width}x${img.height} px; DDS textures should be a power of two per side (64, 128, 256...) or the game may not load them.`))
    const id = alloc()
    if (imageMode === 'dds') {
      defs.push(T.sprite(id))
      loads.push({ nodeId, layer, path, url: `img://${ddsRel(opts.modId, hash)}`, w, h, iw: img.width, ih: img.height, mode: mode === 'fit' ? 'fit' : 'fill' })
      return id
    }
    let bid = bitmaps.get(hash)
    if (bid === undefined) {
      bid = alloc()
      bitmaps.set(hash, bid)
      defs.push(T.defineBitsLossless2(bid, img))
    }
    const shapeId = alloc()
    defs.push(T.defineBitmapShape({ id: shapeId, bitmapId: bid, ...fitImage(mode, img.width, img.height, w, h) }))
    defs.push(T.sprite(id, [T.placeObject2({ depth: 1, charId: shapeId, x: 0, y: 0 })]))
    return id
  }

  /** A frame's image fills as background clips under its children (`imageFill`, `imageFill_2`...): placements + their reserved names. */
  const background = (n: Extract<Swf['nodes'][string], { type: 'frame' }>, path: string): [Buffer[], string[]] => {
    const bg: Buffer[] = []
    const names: string[] = []
    for (const f of n.fills ?? []) {
      if (f.type !== 'image') {
        lint.push(issue('info', 'frame-fill-unsupported', n.id, `Frame ${f.type} fills are not compiled; only image fills are. Use a rectangle for a coloured background.`))
        continue
      }
      const name = names.length ? `imageFill_${names.length + 1}` : 'imageFill'
      const id = imageClip(f.asset, f.scaleMode, n.transform.width, n.transform.height, n.id, n.name, `${path}.${name}`)
      if (id === undefined) continue
      names.push(name)
      bg.push(T.placeObject2({ depth: bg.length + 1, charId: id, name, x: 0, y: 0, ...(f.opacity !== undefined && f.opacity < 1 ? { alpha: f.opacity } : {}) }))
    }
    return [bg, names]
  }

  const place = (frame: { children: string[] }, path: string, first: Buffer[] = [], reserved: string[] = []): Buffer[] => {
    const out: Buffer[] = [...first]
    const names = new Set<string>(reserved)
    let depth = first.length + 1
    for (const cid of frame.children) {
      const n = ir.nodes[cid]
      if (!n) {
        lint.push(issue('warning', 'node-missing', cid, `Child "${cid}" is not in the node map; skipped.`))
        continue
      }
      if (seen.has(cid)) {
        lint.push(issue('error', 'node-cycle', cid, 'Node appears twice in the tree; skipped.'))
        continue
      }
      seen.add(cid)
      if (!n.visible) {
        lint.push(issue('info', 'node-hidden', cid, 'Hidden node not compiled.'))
        continue
      }
      if (n.type === 'instance' || n.type === 'component') {
        lint.push(issue('warning', 'unsupported-node', cid, `${n.type} nodes are not supported yet; "${n.name}" and its children are skipped.`))
        continue
      }
      if (n.blend && !['normal', 'pass_through'].includes(n.blend.toLowerCase())) // Figma sends upper case (PASS_THROUGH is every layer's default)
        lint.push(issue('warning', 'blend-ignored', cid, `Blend mode "${n.blend}" is not supported; ignored.`))
      if (n.mask) lint.push(issue('warning', 'mask-ignored', cid, 'Masks are not supported yet; ignored.'))

      let name = ident(opts.instanceNames?.[cid] ?? n.name)
      for (let i = 2; names.has(name); i++) name = `${ident(opts.instanceNames?.[cid] ?? n.name)}_${i}`
      names.add(name)
      const { x, y, rotation } = n.transform
      const rot = -rotation // Figma rotates counterclockwise, Flash clockwise (unverified in game)
      const base = { depth, name, x, y, ...(rot ? { rotation: rot } : {}), ...(n.opacity < 1 ? { alpha: n.opacity } : {}) }
      const here = `${path}.${name}`

      if (n.type === 'frame') {
        if (n.clipContent) lint.push(issue('info', 'clip-ignored', cid, 'Frame clipping is not applied.'))
        const id = alloc()
        const inner = place(n, here, ...background(n, here))
        defs.push(T.sprite(id, inner))
        out.push(T.placeObject2({ ...base, charId: id }))
      } else if (n.type === 'image') {
        const id = imageClip(n.asset, n.scaleMode, n.transform.width, n.transform.height, cid, n.name, here)
        if (id === undefined) continue
        const alpha = n.opacity * (n.fillOpacity ?? 1)
        const { alpha: _nodeAlpha, ...at } = base
        out.push(T.placeObject2({ ...at, charId: id, ...(alpha < 1 ? { alpha } : {}) }))
      } else if (n.type === 'shape') {
        const r = shapeToSvg(n)
        lint.push(...r.lint)
        if (!r.svg) continue
        const id = alloc()
        shapes.push({ charId: id, nodeId: cid, svg: r.svg })
        defs.push(T.defineShapePlaceholder(id, n.transform.width, n.transform.height))
        out.push(T.placeObject2({ ...base, charId: id }))
      } else {
        const m = mapText(n)
        lint.push(...m.lint)
        if (m.font) fontRows.push({ ...m.font, nodeId: cid, nodeName: n.name })
        if (!m.text) continue
        let fontId = 0
        let fontClass: string | undefined
        if (!opts.preview) {
          fontId = fonts.get(m.text.alias) ?? alloc()
          fonts.set(m.text.alias, fontId)
        } else {
          const fname = (opts.previewFont ?? previewDeviceFont)(m.text.alias)
          if (opts.previewFontBytes?.(fname)) {
            let e = embedded.get(fname)
            if (!e) {
              e = { charId: alloc(), chars: new Set(ASCII) }
              embedded.set(fname, e)
              defs.push(T.defineFont3Placeholder(e.charId, fname))
            }
            for (const c of m.text.field.text) if (c !== '\r') e.chars.add(c)
            fontId = e.charId
          } else fontClass = fname
        }
        const id = alloc()
        defs.push(T.defineEditText({ ...m.text.field, id, fontId, ...(fontClass ? { fontClass } : {}) }))
        // the gutter offset is in the node's own (possibly rotated) space
        const r = (rot * Math.PI) / 180
        const { x: gx, y: gy } = m.text.gutter
        out.push(T.placeObject2({ ...base, charId: id, x: x + gx * Math.cos(r) - gy * Math.sin(r), y: y + gx * Math.sin(r) + gy * Math.cos(r) }))
        if (Object.keys(m.text.script).length) scripts.push({ nodeId: cid, layer: n.name, path: here, script: m.text.script })
      }
      depth++
    }
    return out
  }

  const root = ir.nodes[ir.root]
  let mainPlaces: Buffer[] = []
  let stage = ir.stage
  const widget = opts.widget && !opts.preview
  const wf = widget ? widgetFrame(ir) : undefined
  if (widget && wf) {
    // the widget frame's children live in the clip `widget`; its position/anchor go to the Papyrus script, not the SWF
    seen.add(ir.root)
    seen.add(wf.frame.id)
    const id = alloc()
    defs.push(T.sprite(id, place(wf.frame, 'root.widget', ...background(wf.frame, 'root.widget'))))
    mainPlaces = [T.placeObject2({ depth: 1, charId: id, name: 'widget', x: 0, y: 0, scale: HUD_SCALE })]
    stage = { width: Math.round(ir.stage.width * HUD_SCALE), height: Math.round(ir.stage.height * HUD_SCALE) }
    if (!wf.isRoot)
      for (const cid of root!.type === 'frame' ? root!.children : [])
        if (!seen.has(cid)) lint.push(issue('warning', 'widget-extra-content', cid, 'Only the first frame is the widget; this top-level layer is not compiled.'))
  } else if (root?.type === 'frame') {
    seen.add(ir.root)
    mainPlaces = place(root, 'root', ...background(root, 'root'))
  } else {
    lint.push(issue('error', 'root-invalid', ir.root, 'The root node is missing or not a frame; nothing compiled.'))
  }

  const mod = ident(opts.modId)
  const swfCls = ident(ir.id).replace(/^_?([a-z])/, (_, c: string) => c.toUpperCase())
  const as2: Generated['as2'] = []
  const extra: Buffer[] = []
  const frameCode: string[] = []
  const addClass = (cls: string, source: string): void => {
    const classId = alloc()
    extra.push(T.sprite(classId), T.exportAssets([{ id: classId, name: `__Packages.mods.${mod}.${cls}` }]), T.doInitAction(classId))
    as2.push({ path: `__Packages/mods/${mod}/${cls}.as`, source })
  }
  if (widget && wf) {
    addClass(`${swfCls}Widget`, widgetContractClass(mod, `${swfCls}Widget`))
    frameCode.push(`mods.${mod}.${swfCls}Widget.install(widget);`)
  }
  if (scripts.length) {
    addClass(`${swfCls}Layout`, layoutClass(mod, `${swfCls}Layout`, ir.id, scripts))
    frameCode.push(`mods.${mod}.${swfCls}Layout.apply(this);`)
  }
  if (loads.length) {
    addClass(`${swfCls}Images`, imagesClass(mod, `${swfCls}Images`, ir.id, loads))
    frameCode.push(`mods.${mod}.${swfCls}Images.apply(this);`)
  }
  // Ruffle has no SKSE or SkyUI: stub what Skyrim provides. Only what generated code touches today (gfxExtensions is also set by the layout class).
  if (opts.preview)
    frameCode.unshift(
      '_global.gfxExtensions = true;',
      'if (_global.skse == undefined) _global.skse = { plugins: {}, SendModEvent: function() {}, GetPluginVersion: function() { return 0; } };',
      'if (_global.Inkwell == undefined) _global.Inkwell = { bridge: { send: function() {}, on: function() {} } };'
    )
  if (frameCode.length) as2.push({ path: 'frame_1/DoAction.as', source: ['// Generated by Inkwell: runs once the clips exist.', ...frameCode, ''].join('\n') })

  const tags = [
    T.setBackgroundColor(0, 0, 0),
    ...[...fonts].map(([name, id]) => T.importAssets2('gfxfontlib.swf', { id, name })),
    ...defs,
    ...extra,
    ...mainPlaces,
    ...(frameCode.length ? [T.doAction()] : []),
    T.showFrame(),
    T.endTag()
  ]
  const embeddedFonts = [...embedded].map(([name, e]) => ({ charId: e.charId, name, chars: [...e.chars].join('') }))
  return { tags, shapes, as2, lint, fonts: fontRows, stage, embeddedFonts, gfxTextExtensions: scripts.length, ddsImages: loads.length }
}
