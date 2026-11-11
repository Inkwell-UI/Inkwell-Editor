import { create } from 'zustand'
import { SPEC_VERSION, Slice, type Slices } from '@inkwell-ui/spec'
import { inkwell } from '../hooks/api'
import { strings } from '../../shared/strings'
import type { AssetInfo } from '../../shared/assetsInfo'
import { trackSave } from './saveState'
import { useToastStore } from './toastStore'

/**
 * The Asset View's data (PLAN-SLICING.md): the project's images and `slices.json`. A change is saved at once through IPC (the save rebuilds every SWF).
 * `error` = an unreadable slices.json, which is never written. shortcut: no undo for a slice edit; Clear removes it and the fields are one click away.
 */
export type Side = 'l' | 't' | 'r' | 'b'
export type Ins = Record<Side, number>
export const NO_INS: Ins = { l: 0, t: 0, r: 0, b: 0 }

/** Keeps the insets inside the image with at least 1 px of stretchable middle on each axis. */
export function clampSide(side: Side, v: number, ins: Ins, a: AssetInfo): number {
  const room = side === 'l' ? a.width - ins.r - 1 : side === 'r' ? a.width - ins.l - 1 : side === 't' ? a.height - ins.b - 1 : a.height - ins.t - 1
  return Math.max(0, Math.min(Math.round(Number.isFinite(v) ? v : 0), room))
}

const insOf = (slices: Slices | null, hash: string | undefined): Ins => {
  const s = hash ? slices?.assets[hash] : undefined
  return s ? { l: s.l, t: s.t, r: s.r, b: s.b } : NO_INS
}

export interface SliceStore {
  /** The insets being edited (a guide drag changes them before they are saved). */
  ins: Ins
  setSide(side: Side, v: number): void
  /** Saves the edited insets, or `next` when given. */
  commit(next?: Ins): void
  preset(kind: 'nine' | 'horizontal' | 'vertical' | 'clear'): void
  slices: Slices | null
  error: string | undefined
  assets: AssetInfo[]
  selected: string | undefined
  load(): Promise<void>
  select(hash: string | undefined): void
  /** Sets the insets of an image, or removes its slice with `null`. An invalid set (checked by the Spec schema) is ignored. */
  setSlice(hash: string, ins: { l: number; t: number; r: number; b: number } | null): void
  reset(): void
}

export const useSliceStore = create<SliceStore>()((set, get) => ({
  ins: NO_INS,
  setSide(side, v) {
    const { ins, assets, selected } = get()
    const a = assets.find((x) => x.hash === selected)
    if (a) set({ ins: { ...ins, [side]: clampSide(side, v, ins, a) } })
  },
  commit(next) {
    const { ins, selected } = get()
    const n = next ?? ins
    set({ ins: n })
    // no insets at all is no slice: remove it (the Spec refuses an all-zero slice)
    if (selected) get().setSlice(selected, n.l + n.r + n.t + n.b > 0 ? n : null)
  },
  preset(kind) {
    const a = get().assets.find((x) => x.hash === get().selected)
    if (!a) return
    const qx = Math.max(1, Math.floor(a.width / 4)), qy = Math.max(1, Math.floor(a.height / 4))
    get().commit(kind === 'nine' ? { l: qx, r: qx, t: qy, b: qy } : kind === 'horizontal' ? { l: qx, r: qx, t: 0, b: 0 } : kind === 'vertical' ? { l: 0, r: 0, t: qy, b: qy } : NO_INS)
  },
  slices: null,
  error: undefined,
  assets: [],
  selected: undefined,
  async load() {
    const [s, assets] = await Promise.all([inkwell?.getSlices(), inkwell?.getAssets()])
    set((cur) => {
      const selected = assets?.some((a) => a.hash === cur.selected) ? cur.selected : assets?.[0]?.hash
      const slices = s ? s.slices : cur.slices
      return { ...(s ? { slices: s.slices, error: s.error } : {}), assets: assets ?? [], selected, ins: insOf(slices, selected) }
    })
  },
  select: (hash) => set((cur) => ({ selected: hash, ins: insOf(cur.slices, hash) })),
  setSlice(hash, ins) {
    const { slices, assets, error } = get()
    const a = assets.find((x) => x.hash === hash)
    if (error || !a) return
    const rest = Object.fromEntries(Object.entries(slices?.assets ?? {}).filter(([h]) => h !== hash))
    let next: Record<string, Slice> = rest
    if (ins) {
      const p = Slice.safeParse({ ...(slices?.assets[hash] ?? {}), ...ins, w: a.width, h: a.height })
      if (!p.success) return
      next = { ...rest, [hash]: p.data }
    }
    const doc = { ...(slices ?? {}), specVersion: slices?.specVersion ?? SPEC_VERSION, assets: next } as Slices
    set({ slices: doc })
    trackSave(inkwell?.saveSlices(doc).then((r) => {
      if (!r.ok) useToastStore.getState().push({ tone: 'error', title: strings.assetView.saveFailed(r.error) })
    }))
  },
  reset: () => set({ ins: NO_INS, slices: null, error: undefined, assets: [], selected: undefined })
}))
