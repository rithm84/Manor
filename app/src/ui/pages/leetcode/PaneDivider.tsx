import { useCallback, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, ReactNode, RefObject } from 'react'
import { useDevicePreference } from '../../preferences/devicePreference'

interface PaneSize { readonly percent: number; readonly preview: (value: number) => void; readonly commit: (value: number) => void }

/** A pane's share of its container, in whole percent, remembered on this device once a drag ends. */
export function usePaneSize(key: string, fallback: number, min: number, max: number): PaneSize {
  const options = useRef(Array.from({ length: max - min + 1 }, (_, index) => String(min + index))).current
  const [stored, store] = useDevicePreference(key, options, String(fallback))
  const [live, setLive] = useState<number | null>(null)
  const clamp = useCallback((value: number): number => Math.min(max, Math.max(min, Math.round(value))), [min, max])
  const preview = useCallback((value: number): void => setLive(clamp(value)), [clamp])
  const commit = useCallback((value: number): void => { store(String(clamp(value))); setLive(null) }, [clamp, store])
  return { percent: live ?? Number(stored), preview, commit }
}

interface Props { orientation: 'vertical' | 'horizontal'; label: string; container: RefObject<HTMLElement | null>; size: PaneSize; min: number; max: number; reversed: boolean; testId: string }

/**
 * A draggable separator between two panes. Vertical separators size the leading pane by the
 * pointer's x position; horizontal ones size the trailing pane when `reversed`, as a console below
 * an editor does. Arrow keys step the size for keyboard use.
 */
export function PaneDivider({ orientation, label, container, size, min, max, reversed, testId }: Props): ReactNode {
  const dragging = useRef(false)
  const percentAt = (event: PointerEvent<HTMLDivElement>): number => {
    const box = container.current?.getBoundingClientRect()
    if (box === undefined) throw new Error('The pane container is unavailable while resizing.')
    const ratio = orientation === 'vertical' ? (event.clientX - box.left) / box.width : (event.clientY - box.top) / box.height
    return (reversed ? 1 - ratio : ratio) * 100
  }
  const keyStep = (event: KeyboardEvent<HTMLDivElement>): void => {
    const growKeys = orientation === 'vertical' ? ['ArrowRight'] : [reversed ? 'ArrowUp' : 'ArrowDown']
    const shrinkKeys = orientation === 'vertical' ? ['ArrowLeft'] : [reversed ? 'ArrowDown' : 'ArrowUp']
    if (event.key === 'Home') { event.preventDefault(); size.commit(min); return }
    if (event.key === 'End') { event.preventDefault(); size.commit(max); return }
    const direction = growKeys.includes(event.key) ? 1 : shrinkKeys.includes(event.key) ? -1 : 0
    if (direction === 0) return
    event.preventDefault()
    size.commit(size.percent + direction * 2)
  }
  return <div className={`problem-pane-divider is-${orientation}`} role="separator" aria-orientation={orientation} aria-label={label} aria-valuenow={size.percent} aria-valuemin={min} aria-valuemax={max} tabIndex={0} data-testid={testId}
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId) }}
    onPointerMove={event => { if (dragging.current) size.preview(percentAt(event)) }}
    onPointerUp={event => { if (!dragging.current) return; dragging.current = false; event.currentTarget.releasePointerCapture(event.pointerId); size.commit(percentAt(event)) }}
    onPointerCancel={() => { dragging.current = false; size.commit(size.percent) }}
    onKeyDown={keyStep} />
}
