import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { useDismissLayer } from '../../components/ui'
import { addDays, formatDayLabel, localTodayIso, parseIso, toIso } from './taskModel'

export interface DueDatePickerProps {
  /** ISO date, or null when unset. */
  value: string | null
  onChange: (iso: string) => void
  ariaLabel: string
  min: string | null
  max: string | null
}

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
] as const

const WEEKDAY_HEADERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const

interface MonthCursor {
  year: number
  month: number
}

function cursorFor(iso: string): MonthCursor {
  const date = parseIso(iso)
  return { year: date.getFullYear(), month: date.getMonth() }
}

function shiftMonth(cursor: MonthCursor, delta: number): MonthCursor {
  const date = new Date(cursor.year, cursor.month + delta, 1)
  return { year: date.getFullYear(), month: date.getMonth() }
}

/** Day cells for the visible month, padded with nulls to whole weeks. */
function monthCells(cursor: MonthCursor): readonly (string | null)[] {
  const first = new Date(cursor.year, cursor.month, 1)
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate()
  const cells: (string | null)[] = []
  for (let pad = 0; pad < first.getDay(); pad += 1) {
    cells.push(null)
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(toIso(new Date(cursor.year, cursor.month, day)))
  }
  while (cells.length % 7 !== 0) {
    cells.push(null)
  }
  return cells
}

/**
 * Notion-style date property: trigger reads the current date, popover shows
 * Today/Tomorrow presets over a navigable month grid.
 */
export function DueDatePicker({ value, onChange, ariaLabel, min, max }: DueDatePickerProps): ReactNode {
  const today = localTodayIso(new Date())
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState<MonthCursor>(cursorFor(value ?? today))
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const closeAndFocus = (): void => {
    setOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  // Escape while open dismisses only this picker, never its host dialog.
  useDismissLayer(open, closeAndFocus)

  useEffect(() => {
    if (!open) {
      return
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    return (): void => {
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  const pick = (iso: string): void => {
    if ((min !== null && iso < min) || (max !== null && iso > max)) return
    onChange(iso)
    setCursor(cursorFor(iso))
    closeAndFocus()
  }

  const isAllowed = (iso: string): boolean =>
    (min === null || iso >= min) && (max === null || iso <= max)

  const toggle = (): void => {
    if (!open) {
      setCursor(cursorFor(value ?? today))
    }
    setOpen(!open)
  }

  return (
    <div className="datepicker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="datepicker-trigger"
        aria-label={value === null ? ariaLabel : `${ariaLabel}: ${formatDayLabel(value)}`}
        aria-expanded={open}
        onClick={toggle}
      >
        <CalendarDays size={14} />
        {value !== null ? (
          <span className="tnum">{formatDayLabel(value)}</span>
        ) : (
          <span className="datepicker-empty">Empty</span>
        )}
      </button>

      {open ? (
        <div className="datepicker-menu" role="dialog" aria-label={ariaLabel}>
          <div className="datepicker-presets">
            <button type="button" className="datepicker-preset" disabled={!isAllowed(today)} onClick={() => pick(today)}>
              Today
            </button>
            <button
              type="button"
              className="datepicker-preset"
              disabled={!isAllowed(addDays(today, 1))}
              onClick={() => pick(addDays(today, 1))}
            >
              Tomorrow
            </button>
          </div>
          <div className="datepicker-monthbar">
            <span className="datepicker-monthlabel">
              {MONTH_LABELS[cursor.month]} {cursor.year}
            </span>
            <span className="datepicker-nav">
              <button
                type="button"
                className="datepicker-navbtn"
                aria-label="Previous month"
                onClick={() => setCursor(shiftMonth(cursor, -1))}
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                className="datepicker-navbtn"
                aria-label="Next month"
                onClick={() => setCursor(shiftMonth(cursor, 1))}
              >
                <ChevronRight size={14} />
              </button>
            </span>
          </div>
          <div className="datepicker-grid tnum">
            {WEEKDAY_HEADERS.map((header) => (
              <span key={header} className="datepicker-dow">
                {header}
              </span>
            ))}
            {monthCells(cursor).map((iso, index) =>
              iso === null ? (
                <span key={`pad-${index}`} />
              ) : (
                <button
                  key={iso}
                  type="button"
                  className={`datepicker-day${iso === value ? ' is-selected' : ''}${
                    iso === today ? ' is-today' : ''
                  }`}
                  disabled={!isAllowed(iso)}
                  onClick={() => pick(iso)}
                >
                  {parseIso(iso).getDate()}
                </button>
              )
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
