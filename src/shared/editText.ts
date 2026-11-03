export interface EditTextSpec {
  id: number
  /** Field size in px, including the 2px gutter on each side. */
  wPx: number
  hPx: number
  /** Character id of the imported font (ImportAssets2). */
  fontId: number
  /** Preview only: a device font class (`_sans`...) instead of fontId + outlines. Draws nothing in Skyrim; Ruffle renders it. */
  fontClass?: string
  sizePx: number
  color: { r: number; g: number; b: number; a: number }
  text: string
  wordWrap: boolean
  multiline: boolean
  autoSize: boolean
  /** 0 left, 1 right, 2 center, 3 justify. */
  align: number
  leadingPx: number
}
