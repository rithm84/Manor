import { Popover } from '@base-ui/react/popover'
import { CalendarDays, ChevronLeft, ChevronRight, CornerDownLeft } from 'lucide-react'
import { useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

export interface DatePickerProps {
  value: string | null
  onChange: (value: string | null) => void
  ariaLabel: string
  min: string | null
  max: string | null
  required?: boolean
  today?: string
  showIcon?: boolean
}

interface MonthCursor {
  year: number
  month: number
}

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
] as const
const WEEKDAY_HEADERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const

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
  const date = parseIso(iso)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' })
  }).format(date)
}

export function DatePicker({ value, onChange, ariaLabel, min, max, required, today: accountToday, showIcon }: DatePickerProps): ReactNode {
  const today = accountToday ?? localIso(new Date())
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState<MonthCursor>(cursorFor(value ?? today))
  const [activeDate, setActiveDate] = useState(value ?? today)
  const [typed, setTyped] = useState(value ?? '')
  const [error, setError] = useState<string | null>(null)
  const menu = useRef<HTMLDivElement>(null)
  const allowed = (iso: string): boolean => (min === null || iso >= min) && (max === null || iso <= max)
  const pick = (iso: string): void => {
    if (!allowed(iso)) { setError('Choose a date within the allowed range.'); return }
    onChange(iso); setOpen(false); setError(null)
  }
  const parseTyped = (): string | null => {
    const input = typed.trim().toLowerCase()
    if (input === 'today') return today
    if (input === 'tomorrow') return shiftDate(today, 1)
    if (input === 'next week') return shiftDate(today, 7)
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input)
    if (match && localIso(parseIso(input)) === input) return input
    return null
  }
  const applyTyped = (): void => {
    const parsed = parseTyped()
    if (parsed === null) { setError('Enter YYYY-MM-DD, today, tomorrow, or next week.'); return }
    pick(parsed)
  }
  const focusDay = (iso: string): void => {
    if (!allowed(iso)) return
    setActiveDate(iso); setCursor(cursorFor(iso))
    requestAnimationFrame(() => menu.current?.querySelector<HTMLButtonElement>(`[data-date="${iso}"]`)?.focus())
  }
  const dayKey = (event: KeyboardEvent<HTMLButtonElement>, iso: string): void => {
    const offset = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[event.key]
    if (offset !== undefined) { event.preventDefault(); focusDay(shiftDate(iso, offset)); return }
    if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); const day = parseIso(iso).getDay(); focusDay(shiftDate(iso, event.key === 'Home' ? -day : 6 - day)); return }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault()
      const next = shiftMonth(cursorFor(iso), event.key === 'PageUp' ? -1 : 1)
      focusDay(localIso(new Date(next.year, next.month, Math.min(parseIso(iso).getDate(), new Date(next.year, next.month + 1, 0).getDate()))))
    }
  }
  const cells = datePickerMonthCells(cursor)
  const tabDate = cells.includes(activeDate) && allowed(activeDate) ? activeDate : cells.find(iso => iso !== null && allowed(iso))
  return <Popover.Root open={open} onOpenChange={(next) => {
    if (next) { setTyped(value ?? ''); setCursor(cursorFor(value ?? today)); setActiveDate(value ?? today); setError(null) }
    setOpen(next)
  }}>
    <Popover.Trigger className="ui-datepicker-trigger" aria-label={value === null ? ariaLabel : `${ariaLabel}: ${formatDate(value)}`}>
      {showIcon !== false && <CalendarDays size={15} />}{value === null ? <span className="ui-datepicker-empty">Not set</span> : <span className="tnum">{formatDate(value)}</span>}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Positioner className="ui-popover-positioner" align="start" sideOffset={6} collisionPadding={12}>
        <Popover.Popup ref={menu} className="ui-datepicker-menu" aria-label={`${ariaLabel} calendar`}>
          <div className="ui-date-entry">
            <input aria-label="Type a date" placeholder="YYYY-MM-DD" value={typed} autoComplete="off" onChange={event => { setTyped(event.target.value); setError(null) }}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); applyTyped() } }} />
            <button type="button" aria-label="Apply typed date" onClick={applyTyped}><CornerDownLeft size={14} /></button>
          </div>
          {error && <p className="ui-date-error" role="alert">{error}</p>}
          <div className="ui-datepicker-presets">
            {[['Today', today], ['Tomorrow', shiftDate(today, 1)], ['Next week', shiftDate(today, 7)]].map(([label, iso]) => <button key={label} type="button" disabled={!allowed(iso)} onClick={() => pick(iso)}>{label}</button>)}
          </div>
          <div className="ui-datepicker-monthbar">
            <span>{MONTH_LABELS[cursor.month]} {cursor.year}</span>
            <div className="ui-datepicker-nav">
              <button type="button" aria-label="Previous month" onClick={() => setCursor(shiftMonth(cursor, -1))}><ChevronLeft size={15} /></button>
              <button type="button" aria-label="Next month" onClick={() => setCursor(shiftMonth(cursor, 1))}><ChevronRight size={15} /></button>
            </div>
          </div>
          <div className="ui-datepicker-grid tnum" role="group" aria-label={`${MONTH_LABELS[cursor.month]} ${cursor.year}`}>
            {WEEKDAY_HEADERS.map(day => <span key={day} className="ui-datepicker-dow">{day}</span>)}
            {cells.map((iso, index) => iso === null ? <span key={`pad-${index}`} /> : <button key={iso} type="button" data-date={iso}
              className={`ui-datepicker-day${iso === value ? ' is-selected' : ''}${iso === today ? ' is-today' : ''}`}
              disabled={!allowed(iso)} aria-label={formatDate(iso)} aria-current={iso === today ? 'date' : undefined} aria-pressed={iso === value}
              tabIndex={iso === tabDate ? 0 : -1} onClick={() => pick(iso)} onKeyDown={event => dayKey(event, iso)}>{parseIso(iso).getDate()}</button>)}
          </div>
          {!required && <button className="ui-date-clear" type="button" disabled={value === null} onClick={() => { onChange(null); setOpen(false) }}>Clear date</button>}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>
}
