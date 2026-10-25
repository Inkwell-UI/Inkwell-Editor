import type { LucideIcon } from 'lucide-react'
import { inkwell } from '../hooks/api'
import { useSyncState } from '../hooks/useSyncState'
import { figmaSelectReason } from '../model/connection'
import { useToastStore } from '../state/toastStore'
import { strings } from '../strings'
import { Btn } from './Btn'

/** Select (or, with `focus`, select and zoom to) a layer in Figma. Enabled only while an approved plugin is connected; otherwise disabled with the reason. */
export function FigmaSelectBtn({ nodeId, focus = false, icon }: { nodeId: string; focus?: boolean; icon?: LucideIcon }) {
  const reason = figmaSelectReason(useSyncState(), { notConnected: strings.selectInFigmaReason, pending: strings.selectInFigmaPending })
  const onClick = (): void => {
    void inkwell?.selectInFigma(nodeId, focus).then((r) => {
      if (!r.ok) useToastStore.getState().push({ tone: 'error', title: strings.selectInFigmaFailed(r.error) })
    })
  }
  return <Btn {...(icon ? { icon } : {})} reason={reason} onClick={onClick} testId={focus ? 'focus-in-figma' : 'select-in-figma'}>{focus ? strings.focusInFigma : strings.selectInFigma}</Btn>
}
