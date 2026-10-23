import { create } from 'zustand'
import type { DeployScope, DeployTargetId, PrepareResult } from '../../shared/deploy'
import { inkwell } from '../hooks/api'
import { strings } from '../strings'
import { useToastStore } from './toastStore'

type Prepared = Extract<PrepareResult, { ok: true }>

/**
 * Deploy flow in the renderer. `start` asks main to compile and check (nothing is written), then either writes right away or, for a folder not
 * confirmed for this project yet, opens the confirmation dialog (`confirm` is set) with the exact path and file list. The result is a toast;
 * progress is in the status bar (SyncUiState.deploy).
 */
export interface DeployStore {
  busy: boolean
  scope: DeployScope
  /** Set while the confirmation dialog is open. */
  confirm: { target: DeployTargetId; prepared: Prepared } | null
  setScope(s: DeployScope): void
  start(target: DeployTargetId, activeSwf?: string): Promise<void>
  accept(): Promise<void>
  cancel(): void
}

const toast = useToastStore.getState

export const useDeployStore = create<DeployStore>()((set, get) => {
  const commit = async (p: Prepared): Promise<void> => {
    const r = await inkwell!.commitDeploy(p.token)
    if (r.ok) {
      const lint = p.lint.filter((l) => l.severity !== 'info')
      toast().push({
        tone: lint.length ? 'info' : 'ok',
        title: strings.deploy.toastDone,
        text: `${r.written} written, ${r.unchanged} unchanged${r.removed?.length ? `, ${r.removed.length} removed` : ''} (${p.root})${lint.length ? `. ${lint.map((l) => l.code).join(', ')}` : ''}`
      })
    } else toast().push({ tone: 'error', title: strings.deploy.toastFailed, text: r.error ?? '' })
  }
  return {
    busy: false,
    scope: 'all',
    confirm: null,
    setScope: (scope) => set({ scope }),
    async start(target, activeSwf) {
      if (!inkwell || get().busy) return
      set({ busy: true })
      try {
        const p = await inkwell.prepareDeploy(target, get().scope, get().scope === 'active' ? activeSwf : undefined)
        if (!p.ok) toast().push({ tone: 'error', title: strings.deploy.toastFailed, text: p.error })
        else if (p.needsConfirm) set({ confirm: { target, prepared: p } })
        else await commit(p)
      } finally {
        set({ busy: false })
      }
    },
    async accept() {
      const c = get().confirm
      if (!c || !inkwell) return
      set({ confirm: null, busy: true })
      try {
        await commit(c.prepared)
      } finally {
        set({ busy: false })
      }
    },
    cancel() {
      set({ confirm: null })
      void inkwell?.cancelDeploy()
    }
  }
})
