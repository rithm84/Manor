import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'

export interface DatePickerProps {
  value: string | null
  onChange: (value: string | null) => void
  ariaLabel: string
  min: string | null
  max: string | null
}

interface MonthCursor {
  year: number
  month: number
}

interface MenuPosition {
  left: number
  top: number
}

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
] as const
const WEEKDAY_HEADERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const
const MENU_WIDTH = 260
const MENU_HEIGHT = 330
const VIEWPORT_GUTTER = 12

function localIso(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseIso(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function shiftDate(iso: string, days: number): string {
  const date = parseIso(iso)
  date.setDate(date.getDate() + days)
  return localIso(date)
}

function cursorFor(iso: string): MonthCursor {
  const date = parseIso(iso)
  return { year: date.getFullYear(), month: date.getMonth() }
}

function shiftMonth(cursor: MonthCursor, months: number): MonthCursor {
  const date = new Date(cursor.year, cursor.month + months, 1)
  return { year: date.getFullYear(), month: date.getMonth() }
}

export function datePickerMonthCells(cursor: MonthCursor): readonly (string | null)[] {
  const first = new Date(cursor.year, cursor.month, 1)
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate()
  const cells: (string | null)[] = Array.from({ length: first.getDay() }, () => null)
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(localIso(new Date(cursor.year, cursor.month, day)))
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(parseIso(iso))
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

export function DatePicker({ value, onChange, ariaLabel, min, max }: DatePickerProps): ReactNode {
  const today = localIso(new Date())
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState<MonthCursor>(cursorFor(value ?? today))
  const [activeDate, setActiveDate] = useState(value ?? today)
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const isAllowed = useCallback((iso: string): boolean =>
    (min === null || iso >= min) && (max === null || iso <= max), [max, min])

  const updatePosition = useCallback((): void => {
    if (triggerRef.current !== null) {
      setPosition(menuPosition(triggerRef.current.getBoundingClientRect()))
    }
  }, [])

  const closeAndFocus = useCallback((): void => {
    setOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  const focusDate = useCallback((iso: string): void => {
    if (!isAllowed(iso)) return
    setActiveDate(iso)
    setCursor(cursorFor(iso))
    window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>(`[data-date="${iso}"]`)?.focus()
    })
  }, [isAllowed])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        closeAndFocus()
      }
    }
    const onViewportChange = (): void => updatePosition()
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    focusDate(activeDate)
    return (): void => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [activeDate, closeAndFocus, focusDate, open, updatePosition])

  const pick = (iso: string): void => {
    if (!isAllowed(iso)) return
    onChange(iso)
    setActiveDate(iso)
    setCursor(cursorFor(iso))
    closeAndFocus()
  }

  const toggle = (): void => {
    if (!open) {
      const nextActive = value !== null && isAllowed(value) ? value : today
      setActiveDate(nextActive)
      setCursor(cursorFor(nextActive))
      updatePosition()
    }
    setOpen((current) => !current)
  }

  const onDayKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, iso: string): void => {
    const offsets: Readonly<Record<string, number>> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7
    }
    const offset = offsets[event.key]
    if (offset !== undefined) {
      event.preventDefault()
      focusDate(shiftDate(iso, offset))
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const weekday = parseIso(iso).getDay()
      focusDate(shiftDate(iso, event.key === 'Home' ? -weekday : 6 - weekday))
      return
    }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault()
      const nextCursor = shiftMonth(cursorFor(iso), event.key === 'PageUp' ? -1 : 1)
      const day = Math.min(parseIso(iso).getDate(), new Date(nextCursor.year, nextCursor.month + 1, 0).getDate())
      focusDate(localIso(new Date(nextCursor.year, nextCursor.month, day)))
    }
  }

  const menuStyle: CSSProperties | undefined = position === null
    ? undefined
    : { left: position.left, top: position.top }
  const monthCells = datePickerMonthCells(cursor)
  const activeCursor = cursorFor(activeDate)
  const gridTabDate =
    activeCursor.year === cursor.year &&
    activeCursor.month === cursor.month &&
    isAllowed(activeDate)
      ? activeDate
      : (monthCells.find(
          (date): date is string => date !== null && isAllowed(date)
        ) ?? '')

  return (
    <div className="ui-datepicker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="ui-datepicker-trigger"
        aria-label={value === null ? ariaLabel : `${ariaLabel}: ${formatDate(value)}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <CalendarDays size={14} />
        {value === null ? <span className="ui-datepicker-empty">Not set</span> : <span className="tnum">{formatDate(value)}</span>}
      </button>

      {open ? (
        <div
          ref={menuRef}
          className="ui-datepicker-menu"
          role="dialog"
          aria-label={`${ariaLabel} calendar`}
          style={menuStyle}
        >
          <div className="ui-datepicker-presets">
            <button type="button" disabled={!isAllowed(today)} onClick={() => pick(today)}>Today</button>
            <button
              type="button"
              disabled={value === null}
              onClick={() => {
                onChange(null)
                closeAndFocus()
              }}
            >
              Clear
            </button>
          </div>
          <div className="ui-datepicker-monthbar">
            <span>{MONTH_LABELS[cursor.month]} {cursor.year}</span>
            <span className="ui-datepicker-nav">
              <button type="button" aria-label="Previous month" onClick={() => setCursor(shiftMonth(cursor, -1))}>
                <ChevronLeft size={14} />
              </button>
              <button type="button" aria-label="Next month" onClick={() => setCursor(shiftMonth(cursor, 1))}>
                <ChevronRight size={14} />
              </button>
            </span>
          </div>
          <div className="ui-datepicker-grid tnum" role="grid" aria-label={`${MONTH_LABELS[cursor.month]} ${cursor.year}`}>
            {WEEKDAY_HEADERS.map((header) => <span key={header} className="ui-datepicker-dow">{header}</span>)}
            {monthCells.map((iso, index) => iso === null ? (
              <span key={`pad-${index}`} />
            ) : (
              <button
                key={iso}
                type="button"
                data-date={iso}
                className={`ui-datepicker-day${iso === value ? ' is-selected' : ''}${iso === today ? ' is-today' : ''}`}
                disabled={!isAllowed(iso)}
                aria-label={formatDate(iso)}
                aria-current={iso === today ? 'date' : undefined}
                aria-pressed={iso === value}
                tabIndex={iso === gridTabDate ? 0 : -1}
                onKeyDown={(event) => onDayKeyDown(event, iso)}
                onClick={() => pick(iso)}
              >
                {parseIso(iso).getDate()}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
