import { Clock3 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FocusEvent, KeyboardEvent, ReactNode } from 'react'

export interface TimePickerProps {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  format: '12h' | '24h'
}

interface MenuPosition {
  left: number
  top: number
}

const MENU_WIDTH = 220
const MENU_HEIGHT = 280
const VIEWPORT_GUTTER = 12

export const TIME_PICKER_OPTIONS: readonly string[] = Array.from({ length: 96 }, (_, index) => {
  const minutes = index * 15
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
})

export function formatTimePickerValue(value: string, format: '12h' | '24h'): string {
  const [hourText, minuteText] = value.split(':')
  const hour = Number(hourText)
  const minute = Number(minuteText)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new TypeError('Time picker value must use HH:MM 24-hour format')
  }
  if (format === '24h') return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 === 0 ? 12 : hour % 12
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`
}

export function parseTimePickerText(value: string): string | null {
  const normalized = value.trim().toLocaleLowerCase().replace(/\s+/g, '')
  const twelveHour = /^(\d{1,2})(?::(\d{1,2}))?(am|pm)$/.exec(normalized)
  if (twelveHour !== null) {
    const hour = Number(twelveHour[1])
    const minute = Number(twelveHour[2] ?? '0')
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null
    const convertedHour = hour % 12 + (twelveHour[3] === 'pm' ? 12 : 0)
    return `${String(convertedHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }
  const twentyFourHour = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(normalized)
  if (twentyFourHour === null) return null
  const hour = Number(twentyFourHour[1])
  const minute = Number(twentyFourHour[2] ?? '0')
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function menuPosition(trigger: DOMRect): MenuPosition {
  const maxLeft = Math.max(VIEWPORT_GUTTER, window.innerWidth - MENU_WIDTH - VIEWPORT_GUTTER)
  const left = Math.min(Math.max(trigger.left, VIEWPORT_GUTTER), maxLeft)
  const roomBelow = window.innerHeight - trigger.bottom - VIEWPORT_GUTTER
  const top = roomBelow >= MENU_HEIGHT
    ? trigger.bottom + 4
    : Math.max(VIEWPORT_GUTTER, trigger.top - MENU_HEIGHT - 4)
  return { left, top }
}

function nearestOptionIndex(value: string): number {
  const [hour, minute] = value.split(':').map(Number)
  return Math.min(95, Math.max(0, Math.round((hour * 60 + minute) / 15)))
}

function optionId(ariaLabel: string, index: number): string {
  return `time-option-${ariaLabel.replaceAll(' ', '-').toLocaleLowerCase()}-${index}`
}

export function TimePicker({ value, onChange, ariaLabel, format }: TimePickerProps): ReactNode {
  const [text, setText] = useState(() => formatTimePickerValue(value, format))
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(() => nearestOptionIndex(value))
  const [invalid, setInvalid] = useState(false)
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const controlRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setText(formatTimePickerValue(value, format))
    setActiveIndex(nearestOptionIndex(value))
    setInvalid(false)
  }, [format, value])

  const updatePosition = useCallback((): void => {
    if (controlRef.current !== null) setPosition(menuPosition(controlRef.current.getBoundingClientRect()))
  }, [])
  const close = useCallback((): void => setOpen(false), [])
  const commitText = useCallback((): boolean => {
    const parsed = parseTimePickerText(text)
    if (parsed === null) {
      setInvalid(true)
      return false
    }
    setInvalid(false)
    setText(formatTimePickerValue(parsed, format))
    setActiveIndex(nearestOptionIndex(parsed))
    if (parsed !== value) onChange(parsed)
    return true
  }, [format, onChange, text, value])
  const pick = useCallback((nextValue: string): void => {
    setInvalid(false)
    setText(formatTimePickerValue(nextValue, format))
    setActiveIndex(nearestOptionIndex(nextValue))
    onChange(nextValue)
    close()
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }, [close, format, onChange])
  const openList = useCallback((): void => {
    setActiveIndex(nearestOptionIndex(value))
    updatePosition()
    setOpen(true)
  }, [updatePosition, value])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) close()
    }
    const onViewportChange = (): void => updatePosition()
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, { capture: true, passive: true })
    return (): void => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, { capture: true })
    }
  }, [close, open, updatePosition])

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  const onInputBlur = (event: FocusEvent<HTMLInputElement>): void => {
    if (rootRef.current?.contains(event.relatedTarget) !== true) commitText()
  }
  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) openList()
      else setActiveIndex((current) => Math.min(95, Math.max(0, current + (event.key === 'ArrowDown' ? 1 : -1))))
      return
    }
    if (event.key === 'Home' && open) { event.preventDefault(); setActiveIndex(0); return }
    if (event.key === 'End' && open) { event.preventDefault(); setActiveIndex(95); return }
    if (event.key === 'Escape' && open) { event.preventDefault(); event.nativeEvent.stopImmediatePropagation(); close(); return }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (open) pick(TIME_PICKER_OPTIONS[activeIndex] as string)
      else commitText()
    }
  }

  const menuStyle: CSSProperties | undefined = position === null ? undefined : position
  const activeOptionId = useMemo(() => optionId(ariaLabel, activeIndex), [activeIndex, ariaLabel])
  const listId = `${ariaLabel.replaceAll(' ', '-').toLocaleLowerCase()}-time-list`

  return (
    <div className="ui-timepicker" ref={rootRef}>
      <div ref={controlRef} className={`ui-timepicker-control${invalid ? ' is-invalid' : ''}${open ? ' is-open' : ''}`}>
        <input ref={inputRef} className="ui-timepicker-input" type="text" inputMode="text" role="combobox" aria-label={ariaLabel} aria-expanded={open} aria-controls={listId} aria-activedescendant={open ? activeOptionId : undefined} aria-autocomplete="list" aria-invalid={invalid} value={text} onChange={(event) => { setText(event.target.value); setInvalid(false) }} onBlur={onInputBlur} onKeyDown={onInputKeyDown} />
        <button type="button" aria-label={`Choose ${ariaLabel.toLocaleLowerCase()}`} aria-expanded={open} onClick={() => open ? close() : openList()}><Clock3 size={14} /></button>
      </div>
      {invalid ? <span className="ui-timepicker-error" role="alert">Use a time such as 9:15 AM or 21:15</span> : null}
      {open ? (
        <div ref={listRef} id={listId} className="ui-timepicker-menu tnum" role="listbox" aria-label={`${ariaLabel} choices`} style={menuStyle}>
          {TIME_PICKER_OPTIONS.map((option, index) => (
            <button key={option} id={optionId(ariaLabel, index)} data-index={index} type="button" role="option" tabIndex={-1} aria-selected={option === value} className={`${index === activeIndex ? 'is-active' : ''}${option === value ? ' is-selected' : ''}`} onPointerDown={(event) => event.preventDefault()} onClick={() => pick(option)}>{formatTimePickerValue(option, format)}</button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
