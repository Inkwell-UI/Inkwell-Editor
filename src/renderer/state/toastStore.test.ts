import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from './toastStore'

describe('toastStore', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    useToastStore.setState({ toasts: [] })
  })
  it('pushes, auto-dismisses, keeps the newest four, dismisses by id', () => {
    const s = useToastStore.getState()
    s.push({ tone: 'ok', title: 'a' }, 1000)
    expect(useToastStore.getState().toasts.map((t) => t.title)).toEqual(['a'])
    vi.advanceTimersByTime(1001)
    expect(useToastStore.getState().toasts).toEqual([])
    for (const t of ['1', '2', '3', '4', '5']) s.push({ tone: 'info', title: t }, 0)
    expect(useToastStore.getState().toasts.map((t) => t.title)).toEqual(['2', '3', '4', '5'])
    s.dismiss(useToastStore.getState().toasts[0]!.id)
    expect(useToastStore.getState().toasts).toHaveLength(3)
  })
})
