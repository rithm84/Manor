import { Popover } from '@base-ui/react/popover'
import { Clock3 } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { FocusEvent, KeyboardEvent, ReactNode } from 'react'


export interface TimePickerProps {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  format: '12h' | '24h'
  onValidityChange?: (valid: boolean) => void
}


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

function nearestOptionIndex(value: string): number {
  const [hour, minute] = value.split(':').map(Number)
  return Math.min(95, Math.max(0, Math.round((hour * 60 + minute) / 15)))
}

export function TimePicker({ value, onChange, ariaLabel, format, onValidityChange }: TimePickerProps): ReactNode {
  const typedValue = useRef<string | null>(null)
  const [text, setText] = useState(() => formatTimePickerValue(value, format))
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(() => nearestOptionIndex(value))
  const [invalid, setInvalid] = useState(false)
  const [choosingOption, setChoosingOption] = useState(false)
  const listId = useId()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const controlRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (typedValue.current !== value) setText(formatTimePickerValue(value, format))
    setActiveIndex(nearestOptionIndex(value))
    setInvalid(false)
  }, [format, value])

  const close = useCallback((): void => setOpen(false), [])
  const commitText = useCallback((): boolean => {
    const parsed = parseTimePickerText(text)
    if (parsed === null) {
      setInvalid(true)
      onValidityChange?.(false)
      return false
    }
    setInvalid(false)
    onValidityChange?.(true)
    typedValue.current = parsed
    setText(formatTimePickerValue(parsed, format))
    setActiveIndex(nearestOptionIndex(parsed))
    if (parsed !== value) onChange(parsed)
    return true
  }, [format, onChange, onValidityChange, text, value])
  const pick = useCallback((nextValue: string): void => {
    setInvalid(false)
    onValidityChange?.(true)
    typedValue.current = nextValue
    setText(formatTimePickerValue(nextValue, format))
    setActiveIndex(nearestOptionIndex(nextValue))
    onChange(nextValue)
    close()
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }, [close, format, onChange, onValidityChange])
  const openList = useCallback((): void => {
    setActiveIndex(nearestOptionIndex(value))
    setChoosingOption(false)
    setOpen(true)
  }, [value])

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  const onInputBlur = (event: FocusEvent<HTMLInputElement>): void => {
    if (!rootRef.current?.contains(event.relatedTarget) && !listRef.current?.contains(event.relatedTarget)) commitText()
  }
  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) openList()
      else setActiveIndex((current) => Math.min(95, Math.max(0, current + (event.key === 'ArrowDown' ? 1 : -1))))
      setChoosingOption(true)
      return
    }
    if (event.key === 'Home' && open) { event.preventDefault(); setChoosingOption(true); setActiveIndex(0); return }
    if (event.key === 'End' && open) { event.preventDefault(); setChoosingOption(true); setActiveIndex(95); return }
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      if (open && choosingOption) pick(TIME_PICKER_OPTIONS[activeIndex] as string)
      else if (commitText()) close()
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
    <div className="ui-timepicker" ref={rootRef}>
      <div ref={controlRef} className={`ui-timepicker-control${invalid ? ' is-invalid' : ''}${open ? ' is-open' : ''}`}>
        <input ref={inputRef} className="ui-timepicker-input" type="text" inputMode="text" role="combobox" aria-label={ariaLabel} aria-expanded={open} aria-controls={listId} aria-activedescendant={open && choosingOption ? `${listId}-${activeIndex}` : undefined} aria-autocomplete="list" aria-invalid={invalid} value={text} onClick={() => { if (!open) openList() }} onChange={(event) => { setText(event.target.value); setChoosingOption(false); setInvalid(false); const parsed = parseTimePickerText(event.target.value); onValidityChange?.(parsed !== null); if (parsed !== null) { typedValue.current = parsed; onChange(parsed) } }} onBlur={onInputBlur} onKeyDown={onInputKeyDown} />
        <Popover.Trigger aria-label={`Choose ${ariaLabel.toLocaleLowerCase()}`}><Clock3 size={14} /></Popover.Trigger>
      </div>
      {invalid ? <span className="ui-timepicker-error" role="alert">Use a time such as 9:15 AM or 21:15</span> : null}
    </div>
    <Popover.Portal>
      <Popover.Positioner anchor={controlRef} className="ui-popover-positioner" align="start" sideOffset={6} collisionPadding={12}>
        <Popover.Popup initialFocus={inputRef} finalFocus={inputRef}>
        <div ref={listRef} id={listId} className="ui-timepicker-menu tnum" role="listbox" aria-label={`${ariaLabel} choices`}>
          {TIME_PICKER_OPTIONS.map((option, index) => (
            <button key={option} id={`${listId}-${index}`} data-index={index} type="button" role="option" tabIndex={-1} aria-selected={option === value} className={`${choosingOption && index === activeIndex ? 'is-active' : ''}${option === value ? ' is-selected' : ''}`} onPointerDown={(event) => event.preventDefault()} onClick={() => pick(option)}>{formatTimePickerValue(option, format)}</button>
          ))}
        </div>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
    </Popover.Root>
  )
}
